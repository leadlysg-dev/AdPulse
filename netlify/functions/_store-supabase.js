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

const PROVIDERS = ['meta', 'google'];

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
    adAccounts: (row.ad_accounts || [])
      .sort(byPosition)
      .map((a) => ({ id: a.external_id, name: a.name })),
    selectedAdAccountId: row.selected_ad_account_id,
    connectedAt: row.connected_at
  };
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
    .select('id, email, password_hash, password_set_at, created_at, ai_prefs, ai_insight')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) fail(error, 'loading user');
  if (!u) return null;

  const { data: accounts, error: accError } = await db()
    .from('connected_accounts')
    .select(
      'id, provider, access_token, refresh_token, selected_ad_account_id, connected_at, ' +
        'ad_accounts ( external_id, name, position ), ' +
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
    aiInsight: u.ai_insight,
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

async function saveAiInsight(email, insight) {
  const { error } = await db()
    .from('users')
    .update({ ai_insight: insight })
    .eq('email', email.toLowerCase());
  if (error) fail(error, 'saving AI insight');
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

    const { data: row, error: upsertError } = await db()
      .from('connected_accounts')
      .upsert(
        {
          user_id: userId,
          provider,
          access_token: acc.accessToken || null,
          refresh_token: acc.refreshToken || null,
          selected_ad_account_id: acc.selectedAdAccountId || null,
          connected_at: acc.connectedAt || null
        },
        { onConflict: 'user_id,provider' }
      )
      .select('id')
      .single();
    if (upsertError) fail(upsertError, `saving ${provider} connection`);

    const { error: delAdsError } = await db()
      .from('ad_accounts')
      .delete()
      .eq('connected_account_id', row.id);
    if (delAdsError) fail(delAdsError, `clearing ${provider} ad accounts`);

    if (acc.adAccounts && acc.adAccounts.length) {
      const { error } = await db()
        .from('ad_accounts')
        .insert(
          acc.adAccounts.map((a, i) => ({
            connected_account_id: row.id,
            external_id: a.id,
            name: a.name,
            position: i
          }))
        );
      if (error) fail(error, `saving ${provider} ad accounts`);
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
  saveAiInsight,
  listAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule
};
