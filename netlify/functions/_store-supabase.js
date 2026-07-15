// Supabase (Postgres) storage backend. Replaces the one-JSON-blob-per-user
// model with four normalized tables (users, connected_accounts, ad_accounts,
// selected_metrics - see supabase-schema.sql at the repo root), while
// assembling and accepting the exact same nested user object the rest of
// the functions have always used:
//
//   { id, email, passwordHash, createdAt,
//     accounts: { meta: { accessToken, adAccounts: [{id, name}],
//                         selectedAdAccountId, connectedAt,
//                         selectedMetrics: [{id, label}] },
//                 google: { ...same, plus refreshToken } } }
//
// Connects with the service/secret key (SUPABASE_SECRET_KEY), which
// bypasses RLS - the tables themselves are RLS-locked against the public
// anon key.
const { createClient } = require('@supabase/supabase-js');
const { hashPassword } = require('./_password');

const PROVIDERS = ['meta', 'google', 'gbp'];

let client;
function db() {
  if (!client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set.');
    }
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false }
    });
  }
  return client;
}

function fail(error, doing) {
  throw new Error(`Database error while ${doing}: ${error.message}`);
}

function byPosition(a, b) {
  return a.position - b.position;
}

// One connected_accounts row (with its embedded child rows) back into the
// provider object shape the rest of the code expects.
function assembleProvider(row) {
  const provider = {
    accessToken: row.access_token,
    adAccounts: (row.ad_accounts || []).sort(byPosition).map((a) => {
      const account = { id: a.external_id, name: a.name };
      // Google accounts reached through a manager (MCC) carry the manager
      // id reporting calls must authenticate through.
      if (a.login_customer_id) account.loginCustomerId = a.login_customer_id;
      return account;
    }),
    selectedAdAccountId: row.selected_ad_account_id,
    connectedAt: row.connected_at
  };
  if (row.can_manage !== null && row.can_manage !== undefined) provider.canManage = row.can_manage;
  const scProps = (row.sc_properties || [])
    .sort(byPosition)
    .map((p) => ({ siteUrl: p.site_url, permission: p.permission }));
  if (scProps.length) provider.scProperties = scProps;
  if (row.selected_sc_site_url) provider.selectedScSiteUrl = row.selected_sc_site_url;
  if (row.refresh_token) provider.refreshToken = row.refresh_token;
  const metrics = (row.selected_metrics || [])
    .sort(byPosition)
    .map((m) => {
      const metric = { id: m.metric_id, label: m.label };
      if (m.target_cost_per != null) metric.targetCostPer = Number(m.target_cost_per);
      return metric;
    });
  if (metrics.length) provider.selectedMetrics = metrics;
  return provider;
}

async function getUser(email) {
  const { data: u, error } = await db()
    .from('users')
    .select('id, email, password_hash, password_set_at, created_at, ai_prefs')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) fail(error, 'loading user');
  if (!u) return null;

  const { data: accounts, error: accError } = await db()
    .from('connected_accounts')
    .select(
      // Base columns select * so not-yet-migrated columns (login_customer_id,
      // can_manage, ...) can't break every getUser call app-wide.
      '*, ' +
        'ad_accounts ( * ), ' +
        'sc_properties ( site_url, permission, position ), ' +
        'selected_metrics ( metric_id, label, position, target_cost_per )'
    )
    .eq('user_id', u.id);
  if (accError) fail(accError, 'loading connected accounts');

  const user = {
    id: u.id,
    email: u.email,
    passwordHash: u.password_hash,
    passwordSetAt: u.password_set_at,
    createdAt: u.created_at,
    aiPrefs: u.ai_prefs,
    accounts: {}
  };
  (accounts || []).forEach((row) => {
    user.accounts[row.provider] = assembleProvider(row);
  });
  return user;
}

// opts.passwordSet=false marks the password as a placeholder (accounts
// auto-created by Google sign-in), so Settings offers "Set password".
async function createUser(email, password, opts = {}) {
  const { data, error } = await db()
    .from('users')
    .insert({
      email: email.toLowerCase(),
      password_hash: hashPassword(password),
      password_set_at: opts.passwordSet === false ? null : new Date().toISOString()
    })
    .select('id, email, password_hash, password_set_at, created_at, ai_prefs')
    .single();
  if (error) {
    // 23505 = Postgres unique violation; same message the Blobs backend threw.
    if (error.code === '23505') throw new Error('An account with that email already exists.');
    fail(error, 'creating user');
  }
  return {
    id: data.id,
    email: data.email,
    passwordHash: data.password_hash,
    passwordSetAt: data.password_set_at,
    createdAt: data.created_at,
    aiPrefs: data.ai_prefs,
    accounts: {}
  };
}

// The two Settings writes target the users row directly - saveUser only
// manages the connection tables and never touches users.
async function setPassword(email, password) {
  const { error } = await db()
    .from('users')
    .update({ password_hash: hashPassword(password), password_set_at: new Date().toISOString() })
    .eq('email', email.toLowerCase());
  if (error) fail(error, 'saving password');
}

async function saveAiPrefs(email, prefs) {
  const { error } = await db()
    .from('users')
    .update({ ai_prefs: prefs })
    .eq('email', email.toLowerCase());
  if (error) fail(error, 'saving AI preferences');
}

// Per-view insight cache: one row per (user, dashboard range), upserted.
async function getAiInsightCache(email, range) {
  const userId = await userIdFor(email);
  const { data, error } = await db()
    .from('ai_insight_cache')
    .select('prefs_hash, data_hash, summary, generated_at')
    .eq('user_id', userId)
    .eq('range', range)
    .maybeSingle();
  if (error) fail(error, 'loading insight cache');
  if (!data) return null;
  return {
    prefsHash: data.prefs_hash,
    dataHash: data.data_hash,
    summary: data.summary,
    generatedAt: data.generated_at
  };
}

// Wipe every cached insight for a user - called when a platform connects
// or the tracked metrics change, so the next view regenerates fresh.
async function clearAiInsightCache(email) {
  const userId = await userIdFor(email);
  const { error } = await db().from('ai_insight_cache').delete().eq('user_id', userId);
  if (error) fail(error, 'clearing insight cache');
}

async function saveAiInsightCache(email, range, entry) {
  const userId = await userIdFor(email);
  const { error } = await db()
    .from('ai_insight_cache')
    .upsert(
      {
        user_id: userId,
        range,
        prefs_hash: entry.prefsHash,
        data_hash: entry.dataHash,
        summary: entry.summary,
        generated_at: entry.generatedAt
      },
      { onConflict: 'user_id,range' }
    );
  if (error) fail(error, 'saving insight cache');
}

// --- Ad-management audit log ---

async function createChangeLog(email, entry) {
  const userId = await userIdFor(email);
  const { error } = await db().from('ad_change_log').insert({
    user_id: userId,
    channel: entry.channel,
    account_id: entry.accountId,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    entity_name: entry.entityName || null,
    action: entry.action,
    old_value: entry.oldValue != null ? String(entry.oldValue) : null,
    new_value: entry.newValue != null ? String(entry.newValue) : null,
    api_result: entry.apiResult ? String(entry.apiResult).slice(0, 2000) : null
  });
  if (error) fail(error, 'writing the change log');
}

async function listChangeLog(email, limit = 100) {
  const userId = await userIdFor(email);
  const { data, error } = await db()
    .from('ad_change_log')
    .select('channel, account_id, entity_type, entity_id, entity_name, action, old_value, new_value, api_result, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'loading the change log');
  return (data || []).map((r) => ({
    channel: r.channel,
    accountId: r.account_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityName: r.entity_name,
    action: r.action,
    oldValue: r.old_value,
    newValue: r.new_value,
    apiResult: r.api_result,
    createdAt: r.created_at
  }));
}

// --- Leadly Studio records (jobs, chains, motion runs, uploads, docs, brands) ---
// One generic JSON-document table (see migration 010): every Studio concept
// is a small blob read back whole, by id or newest-first, always per-user.

async function getStudioRecord(email, kind, id) {
  const userId = await userIdFor(email);
  const { data, error } = await db()
    .from('studio_records')
    .select('data')
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('id', id)
    .maybeSingle();
  if (error) fail(error, `loading studio ${kind}`);
  return data ? data.data : null;
}

async function putStudioRecord(email, kind, id, record) {
  const userId = await userIdFor(email);
  const { error } = await db()
    .from('studio_records')
    .upsert(
      { user_id: userId, kind, id, data: record, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,kind,id' }
    );
  if (error) fail(error, `saving studio ${kind}`);
}

// opts.idPrefix narrows jobs to one project (job ids start with the project
// slug); opts.limit caps the result. Newest first.
async function listStudioRecords(email, kind, opts = {}) {
  const userId = await userIdFor(email);
  let query = db()
    .from('studio_records')
    .select('id, data')
    .eq('user_id', userId)
    .eq('kind', kind)
    .order('updated_at', { ascending: false })
    .limit(opts.limit || 100);
  if (opts.idPrefix) query = query.like('id', `${opts.idPrefix}%`);
  const { data, error } = await query;
  if (error) fail(error, `listing studio ${kind}s`);
  return (data || []).map((r) => r.data);
}

// --- Alert rules (created by the AI assistant) ---

async function userIdFor(email) {
  const { data: u, error } = await db()
    .from('users')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) fail(error, 'looking up user');
  if (!u) throw new Error('User not found.');
  return u.id;
}

function assembleRule(row) {
  return {
    id: row.id,
    metric: row.metric,
    channel: row.channel,
    comparison: row.comparison,
    threshold: Number(row.threshold),
    timeframe: row.timeframe,
    enabled: row.enabled,
    description: row.description,
    createdAt: row.created_at
  };
}

async function listAlertRules(email) {
  const userId = await userIdFor(email);
  const { data, error } = await db()
    .from('alert_rules')
    .select('id, metric, channel, comparison, threshold, timeframe, enabled, description, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) fail(error, 'loading alert rules');
  return (data || []).map(assembleRule);
}

async function createAlertRule(email, rule) {
  const userId = await userIdFor(email);
  const { data, error } = await db()
    .from('alert_rules')
    .insert({
      user_id: userId,
      metric: rule.metric,
      channel: rule.channel,
      comparison: rule.comparison,
      threshold: rule.threshold,
      timeframe: rule.timeframe,
      description: rule.description
    })
    .select('id, metric, channel, comparison, threshold, timeframe, enabled, description, created_at')
    .single();
  if (error) fail(error, 'saving alert rule');
  return assembleRule(data);
}

async function updateAlertRule(email, ruleId, enabled) {
  const userId = await userIdFor(email);
  const { error } = await db()
    .from('alert_rules')
    .update({ enabled })
    .eq('id', ruleId)
    .eq('user_id', userId); // scoped so one user can never touch another's rule
  if (error) fail(error, 'updating alert rule');
}

async function deleteAlertRule(email, ruleId) {
  const userId = await userIdFor(email);
  const { error } = await db()
    .from('alert_rules')
    .delete()
    .eq('id', ruleId)
    .eq('user_id', userId);
  if (error) fail(error, 'deleting alert rule');
}

// Persists the (mutated) user object. Provider rows are upserted and their
// child rows replaced wholesale, which reproduces the Blobs semantics
// exactly - e.g. reconnecting Meta replaces the whole provider object,
// clearing any previous metric selection.
async function saveUser(user) {
  let userId = user.id;
  if (!userId) {
    const { data: u, error } = await db()
      .from('users')
      .select('id')
      .eq('email', user.email.toLowerCase())
      .maybeSingle();
    if (error) fail(error, 'looking up user');
    if (!u) throw new Error('User not found.');
    userId = u.id;
  }

  for (const provider of PROVIDERS) {
    const acc = user.accounts && user.accounts[provider];

    if (!acc) {
      const { error } = await db()
        .from('connected_accounts')
        .delete()
        .eq('user_id', userId)
        .eq('provider', provider);
      if (error) fail(error, `removing ${provider} connection`);
      continue;
    }

    const connectionRow = {
      user_id: userId,
      provider,
      access_token: acc.accessToken || null,
      refresh_token: acc.refreshToken || null,
      selected_ad_account_id: acc.selectedAdAccountId || null,
      selected_sc_site_url: acc.selectedScSiteUrl || null,
      connected_at: acc.connectedAt || null,
      can_manage: acc.canManage === undefined ? null : acc.canManage
    };
    let { data: row, error: upsertError } = await db()
      .from('connected_accounts')
      .upsert(connectionRow, { onConflict: 'user_id,provider' })
      .select('id')
      .single();
    // Migration 009 adds can_manage; until it's run, retry without it.
    if (upsertError && /can_manage/.test(upsertError.message || '')) {
      console.error(`[store] connected_accounts.can_manage missing - run migration 009: ${upsertError.message}`);
      delete connectionRow.can_manage;
      ({ data: row, error: upsertError } = await db()
        .from('connected_accounts')
        .upsert(connectionRow, { onConflict: 'user_id,provider' })
        .select('id')
        .single());
    }
    if (upsertError) fail(upsertError, `saving ${provider} connection`);

    const { error: delAdsError } = await db()
      .from('ad_accounts')
      .delete()
      .eq('connected_account_id', row.id);
    if (delAdsError) fail(delAdsError, `clearing ${provider} ad accounts`);

    if (acc.adAccounts && acc.adAccounts.length) {
      const rows = acc.adAccounts.map((a, i) => ({
        connected_account_id: row.id,
        external_id: a.id,
        name: a.name,
        position: i,
        login_customer_id: a.loginCustomerId || null
      }));
      let { error } = await db().from('ad_accounts').insert(rows);
      // Migration 007 adds login_customer_id; until it's run, retry without
      // the column so connecting still works (MCC routing just won't stick).
      if (error && /login_customer_id/.test(error.message || '')) {
        console.error(
          `[store] ad_accounts.login_customer_id missing - run migration 007. Saving without it: ${error.message}`
        );
        ({ error } = await db()
          .from('ad_accounts')
          .insert(rows.map(({ login_customer_id, ...rest }) => rest)));
      }
      if (error) fail(error, `saving ${provider} ad accounts`);
    }

    const { error: delScError } = await db()
      .from('sc_properties')
      .delete()
      .eq('connected_account_id', row.id);
    if (delScError) fail(delScError, `clearing ${provider} Search Console properties`);

    if (acc.scProperties && acc.scProperties.length) {
      const { error } = await db()
        .from('sc_properties')
        .insert(
          acc.scProperties.map((p, i) => ({
            connected_account_id: row.id,
            site_url: p.siteUrl,
            permission: p.permission || null,
            position: i
          }))
        );
      if (error) fail(error, `saving ${provider} Search Console properties`);
    }

    const { error: delMetricsError } = await db()
      .from('selected_metrics')
      .delete()
      .eq('connected_account_id', row.id);
    if (delMetricsError) fail(delMetricsError, `clearing ${provider} metrics`);

    if (acc.selectedMetrics && acc.selectedMetrics.length) {
      const { error } = await db()
        .from('selected_metrics')
        .insert(
          acc.selectedMetrics.map((m, i) => ({
            connected_account_id: row.id,
            metric_id: m.id,
            label: m.label,
            position: i,
            target_cost_per: m.targetCostPer != null ? m.targetCostPer : null
          }))
        );
      if (error) fail(error, `saving ${provider} metrics`);
    }
  }
}

module.exports = {
  getUser,
  createUser,
  saveUser,
  setPassword,
  saveAiPrefs,
  getAiInsightCache,
  saveAiInsightCache,
  clearAiInsightCache,
  createChangeLog,
  listChangeLog,
  getStudioRecord,
  putStudioRecord,
  listStudioRecords,
  listAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule
};
