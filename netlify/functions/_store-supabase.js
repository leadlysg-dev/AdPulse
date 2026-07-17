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

// --- Workspaces (multi-tenant, invite-only) ---
// A workspace owns the ad connections; members are 'owner' (agency) or
// 'client' (invited). Clients read their workspace's data through the
// owner's connections and never OAuth themselves.

function assembleMembership(row) {
  return {
    id: row.workspace_id,
    role: row.role,
    name: row.workspaces ? row.workspaces.name : null,
    billingExempt: row.workspaces ? row.workspaces.billing_exempt : false
  };
}

async function listMemberships(email) {
  const userId = await userIdFor(email);
  const { data, error } = await db()
    .from('workspace_members')
    .select('workspace_id, role, workspaces ( name, billing_exempt )')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) fail(error, 'loading workspaces');
  return (data || []).map(assembleMembership);
}

// The first owner of a workspace is the account whose OAuth connections the
// workspace's clients read through.
async function workspaceOwnerEmail(workspaceId) {
  const { data, error } = await db()
    .from('workspace_members')
    .select('users ( email )')
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) fail(error, 'looking up the workspace owner');
  return data && data.users ? data.users.email : null;
}

// Platform-level role check: is this user a Leadly platform admin?
async function isPlatformAdmin(email) {
  try {
    const userId = await userIdFor(email);
    const { data, error } = await db().from('user_roles').select('role').eq('user_id', userId).maybeSingle();
    if (error) fail(error, 'checking platform role');
    return !!data && data.role === 'platform_admin';
  } catch {
    return false; // migration 014 not run yet, or no such user
  }
}

async function getWorkspaceById(workspaceId) {
  const { data, error } = await db()
    .from('workspaces')
    .select('id, name, billing_exempt, managed')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error) fail(error, 'loading the workspace');
  return data ? { id: data.id, name: data.name, billingExempt: data.billing_exempt, managed: data.managed !== false } : null;
}

// The admin directory: every workspace with its owner, member count,
// connection health (through the owner's connections), and last activity.
async function listAllWorkspaces() {
  const [wsRes, memberRes, connRes, crRes] = await Promise.all([
    db().from('workspaces').select('id, name, billing_exempt, managed, created_at').order('created_at', { ascending: true }),
    db().from('workspace_members').select('workspace_id, role, created_at, users ( id, email )'),
    db().from('connected_accounts').select('user_id, provider, selected_ad_account_id'),
    db().from('change_requests').select('workspace_id, created_at').order('created_at', { ascending: false }).limit(500)
  ]);
  for (const r of [wsRes, memberRes, connRes, crRes]) if (r.error) fail(r.error, 'loading the workspace directory');

  const membersByWs = {};
  (memberRes.data || []).forEach((m) => {
    (membersByWs[m.workspace_id] = membersByWs[m.workspace_id] || []).push(m);
  });
  const connsByUser = {};
  (connRes.data || []).forEach((c) => {
    (connsByUser[c.user_id] = connsByUser[c.user_id] || {})[c.provider] = !!c.selected_ad_account_id;
  });
  const lastCrByWs = {};
  (crRes.data || []).forEach((c) => {
    if (!lastCrByWs[c.workspace_id]) lastCrByWs[c.workspace_id] = c.created_at;
  });

  return (wsRes.data || []).map((w) => {
    const members = (membersByWs[w.id] || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const owner = members.find((m) => m.role === 'owner');
    const conns = (owner && owner.users && connsByUser[owner.users.id]) || {};
    const activity = [w.created_at, ...members.map((m) => m.created_at), lastCrByWs[w.id]].filter(Boolean).sort();
    return {
      id: w.id,
      name: w.name,
      billingExempt: w.billing_exempt,
      managed: w.managed !== false,
      createdAt: w.created_at,
      ownerEmail: owner && owner.users ? owner.users.email : null,
      memberCount: members.length,
      meta: conns.meta === true ? 'ok' : conns.meta === false ? 'partial' : 'off',
      google: conns.google === true ? 'ok' : conns.google === false ? 'partial' : 'off',
      lastActivity: activity[activity.length - 1] || w.created_at
    };
  });
}

async function createWorkspace(name, managed) {
  const { data, error } = await db()
    .from('workspaces')
    .insert({ name: String(name).slice(0, 80), managed: managed !== false })
    .select('id, name, managed')
    .single();
  if (error) fail(error, 'creating the workspace');
  return { id: data.id, name: data.name, managed: data.managed !== false };
}

// Every admin visit into a client workspace is a logged session.
async function createAdminSession(adminEmail, workspaceId) {
  const userId = await userIdFor(adminEmail);
  const { data, error } = await db()
    .from('admin_sessions')
    .insert({ admin_user_id: userId, workspace_id: workspaceId })
    .select('id')
    .single();
  if (error) fail(error, 'logging the admin session');
  return data.id;
}

async function endAdminSessions(adminEmail) {
  const userId = await userIdFor(adminEmail);
  const { error } = await db()
    .from('admin_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('admin_user_id', userId)
    .is('ended_at', null);
  if (error) fail(error, 'ending the admin session');
}

// Best-effort audit trail; failures never block the action they describe.
async function writeAudit(actorEmail, action, workspaceId, detail) {
  try {
    const userId = actorEmail ? await userIdFor(actorEmail) : null;
    await db().from('audit_log').insert({ actor_user_id: userId, action, workspace_id: workspaceId || null, detail: detail || null });
  } catch (err) {
    console.error(`[store] audit write failed: ${err.message}`);
  }
}

async function listWorkspaceMembers(workspaceId) {
  const { data, error } = await db()
    .from('workspace_members')
    .select('role, created_at, users ( email )')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) fail(error, 'loading workspace members');
  return (data || []).map((m) => ({ email: m.users ? m.users.email : null, role: m.role, addedAt: m.created_at }));
}

async function addWorkspaceMember(workspaceId, email, role) {
  const user = await getUser(email.toLowerCase());
  if (!user) throw new Error('No Pulse account with that email yet — send them an invite link instead.');
  const { error } = await db()
    .from('workspace_members')
    .upsert({ workspace_id: workspaceId, user_id: user.id, role }, { onConflict: 'workspace_id,user_id' });
  if (error) fail(error, 'adding the member');
}

async function removeWorkspaceMember(workspaceId, email) {
  const userId = await userIdFor(email.toLowerCase());
  const { data: owners, error: oErr } = await db()
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner');
  if (oErr) fail(oErr, 'checking owners');
  if ((owners || []).length === 1 && owners[0].user_id === userId) {
    throw new Error("You can't remove the workspace's only owner.");
  }
  const { error } = await db().from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
  if (error) fail(error, 'removing the member');
}

// Mint a single-use invite carrying its intended role. A fresh owner invite
// invalidates any unused prior owner invite for the same workspace. Allowed
// for workspace owners, agency members, and platform admins.
async function createWorkspaceInvite(email, workspaceId, role = 'client') {
  const userId = await userIdFor(email);
  const { data: member, error: mErr } = await db()
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (mErr) fail(mErr, 'checking workspace role');
  const allowed = (member && (member.role === 'owner' || member.role === 'agency')) || (await isPlatformAdmin(email));
  if (!allowed) throw new Error('Only a workspace owner or Leadly can create invite links.');
  if (!['owner', 'agency', 'client', 'member'].includes(role)) throw new Error('Unknown invite role.');

  if (role === 'owner') {
    const { error: delErr } = await db()
      .from('workspace_invites')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('role', 'owner')
      .is('used_by', null);
    if (delErr) fail(delErr, 'invalidating the previous owner invite');
  }

  const token = require('crypto').randomBytes(24).toString('base64url');
  const { error } = await db().from('workspace_invites').insert({
    token,
    workspace_id: workspaceId,
    created_by: userId,
    role,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
  });
  if (error) fail(error, 'creating the invite');
  return token;
}

// Peek at an invite without claiming it - drives the accept page's states.
async function getWorkspaceInvite(token) {
  const { data, error } = await db()
    .from('workspace_invites')
    .select('workspace_id, used_by, expires_at, role, workspaces ( name )')
    .eq('token', token)
    .maybeSingle();
  if (error) fail(error, 'reading the invite');
  if (!data) return null;
  return {
    workspaceId: data.workspace_id,
    workspaceName: data.workspaces ? data.workspaces.name : null,
    role: data.role || 'client',
    used: !!data.used_by,
    expired: new Date(data.expires_at) < new Date()
  };
}

// Single use: the row is claimed with a guarded update, so two concurrent
// accepts can't both succeed. opts.viaGoogle creates the account without a
// password (Google's verified email is the proof of identity).
async function acceptWorkspaceInvite(token, email, password, opts = {}) {
  const { data: invite, error } = await db()
    .from('workspace_invites')
    .select('workspace_id, used_by, expires_at, role')
    .eq('token', token)
    .maybeSingle();
  if (error) fail(error, 'reading the invite');
  if (!invite) throw new Error('That invite link is not valid.');
  if (invite.used_by) throw new Error('That invite link has already been used.');
  if (new Date(invite.expires_at) < new Date()) throw new Error('That invite link has expired.');

  let user = await getUser(email);
  let created = false;
  if (!user) {
    user = opts.viaGoogle
      ? await createUser(email, require('crypto').randomBytes(24).toString('hex'), { passwordSet: false })
      : await createUser(email, password);
    created = true;
  }

  const { data: claimed, error: claimErr } = await db()
    .from('workspace_invites')
    .update({ used_by: user.id, used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_by', null)
    .select('workspace_id')
    .maybeSingle();
  if (claimErr) fail(claimErr, 'claiming the invite');
  if (!claimed) throw new Error('That invite link has already been used.');

  const role = ['owner', 'agency', 'client', 'member'].includes(invite.role) ? invite.role : 'client';
  const { error: memberErr } = await db()
    .from('workspace_members')
    .upsert(
      { workspace_id: invite.workspace_id, user_id: user.id, role },
      { onConflict: 'workspace_id,user_id', ignoreDuplicates: true }
    );
  if (memberErr) fail(memberErr, 'adding you to the workspace');
  return { workspaceId: invite.workspace_id, created, role };
}

async function createChangeRequest(email, workspaceId, payload) {
  const userId = await userIdFor(email);
  const { error } = await db().from('change_requests').insert({
    workspace_id: workspaceId,
    requested_by: userId,
    request: String(payload.request || '').slice(0, 2000),
    entity_type: payload.entityType || null,
    entity_id: payload.entityId || null,
    action: payload.action || null,
    value: payload.value != null ? String(payload.value) : null
  });
  if (error) fail(error, 'saving the change request');
}

async function listChangeRequests(workspaceId, limit = 100) {
  const { data, error } = await db()
    .from('change_requests')
    .select('id, request, entity_type, entity_id, action, value, status, created_at, users:requested_by ( email )')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, 'loading change requests');
  return (data || []).map((r) => ({
    id: r.id,
    request: r.request,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    value: r.value,
    status: r.status,
    requestedBy: r.users ? r.users.email : null,
    createdAt: r.created_at
  }));
}

async function getMetricsConfig(workspaceId) {
  const { data, error } = await db().from('workspaces').select('metrics_config').eq('id', workspaceId).maybeSingle();
  if (error) fail(error, 'loading metrics config');
  return (data && data.metrics_config) || null;
}

async function saveMetricsConfig(workspaceId, config) {
  const { error } = await db().from('workspaces').update({ metrics_config: config }).eq('id', workspaceId);
  if (error) fail(error, 'saving metrics config');
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
  listMemberships,
  getMetricsConfig,
  saveMetricsConfig,
  workspaceOwnerEmail,
  isPlatformAdmin,
  getWorkspaceById,
  listAllWorkspaces,
  createWorkspace,
  createAdminSession,
  endAdminSessions,
  writeAudit,
  listWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
  getWorkspaceInvite,
  createWorkspaceInvite,
  acceptWorkspaceInvite,
  createChangeRequest,
  listChangeRequests,
  listAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule
};
