// The original Netlify Blobs storage backend, kept intact as a fallback
// while the Supabase migration is being verified. Activate it by setting
// STORAGE_BACKEND=blobs in Netlify's environment variables (see _store.js).
// Each customer is one JSON blob keyed by lowercase email.
const { getStore } = require('@netlify/blobs');
const { hashPassword } = require('./_password');

function usersStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'adpulse-users', siteID, token });
  }
  return getStore('adpulse-users');
}

async function getUser(email) {
  const store = usersStore();
  return await store.get(email.toLowerCase(), { type: 'json' });
}

// opts.passwordSet=false marks the password as a placeholder (accounts
// auto-created by Google sign-in). Blob users predating this field have no
// passwordSetAt key at all - callers treat that as "set", matching the
// Supabase migration's backfill.
async function createUser(email, password, opts = {}) {
  const store = usersStore();
  const key = email.toLowerCase();
  const existing = await store.get(key, { type: 'json' });
  if (existing) throw new Error('An account with that email already exists.');
  const user = {
    email: key,
    passwordHash: hashPassword(password),
    passwordSetAt: opts.passwordSet === false ? null : new Date().toISOString(),
    createdAt: new Date().toISOString(),
    accounts: {} // provider -> { accessToken, refreshToken, adAccounts: [...], selectedAdAccountId, selectedMetrics }
  };
  await store.setJSON(key, user);
  return user;
}

async function saveUser(user) {
  const store = usersStore();
  await store.setJSON(user.email, user);
}

async function setPassword(email, password) {
  const store = usersStore();
  const key = email.toLowerCase();
  const user = await store.get(key, { type: 'json' });
  if (!user) throw new Error('User not found.');
  user.passwordHash = hashPassword(password);
  user.passwordSetAt = new Date().toISOString();
  await store.setJSON(key, user);
}

async function saveAiPrefs(email, prefs) {
  const store = usersStore();
  const key = email.toLowerCase();
  const user = await store.get(key, { type: 'json' });
  if (!user) throw new Error('User not found.');
  user.aiPrefs = prefs;
  await store.setJSON(key, user);
}

// Per-view insight cache: a small map keyed by dashboard range.
async function getAiInsightCache(email, range) {
  const store = usersStore();
  const user = await store.get(email.toLowerCase(), { type: 'json' });
  return (user && user.aiInsightCache && user.aiInsightCache[range]) || null;
}

async function saveAiInsightCache(email, range, entry) {
  await withUser(email, (user) => {
    user.aiInsightCache = { ...(user.aiInsightCache || {}), [range]: entry };
  });
}

async function createChangeLog(email, entry) {
  await withUser(email, (user) => {
    user.changeLog = [{ ...entry, createdAt: new Date().toISOString() }, ...(user.changeLog || [])].slice(0, 200);
  });
}

async function listChangeLog(email, limit = 100) {
  const user = await getUser(email);
  return ((user && user.changeLog) || []).slice(0, limit);
}

async function clearAiInsightCache(email) {
  await withUser(email, (user) => {
    delete user.aiInsightCache;
  });
}

// --- Leadly Studio records: one blob per document, in their own store ---
// Keyed <email>/<kind>/<id>. Studio ids embed an ISO timestamp (jobs are
// "<project>--<stamp>", chains "chain--<stamp>", ...) so a reverse key sort
// is newest-first without reading every blob's contents.

function studioStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'adpulse-studio', siteID, token });
  }
  return getStore('adpulse-studio');
}

const studioKey = (email, kind, id) => `${email.toLowerCase()}/${kind}/${id}`;

async function getStudioRecord(email, kind, id) {
  return await studioStore().get(studioKey(email, kind, id), { type: 'json' });
}

async function putStudioRecord(email, kind, id, record) {
  await studioStore().setJSON(studioKey(email, kind, id), record);
}

async function listStudioRecords(email, kind, opts = {}) {
  const store = studioStore();
  const prefix = `${email.toLowerCase()}/${kind}/${opts.idPrefix || ''}`;
  const { blobs } = await store.list({ prefix });
  const keys = (blobs || [])
    .map((b) => b.key)
    .sort()
    .reverse()
    .slice(0, opts.limit || 100);
  const records = await Promise.all(keys.map((k) => store.get(k, { type: 'json' })));
  return records.filter(Boolean);
}

// --- Alert rules: stored as an array on the user blob ---

async function withUser(email, mutate) {
  const store = usersStore();
  const key = email.toLowerCase();
  const user = await store.get(key, { type: 'json' });
  if (!user) throw new Error('User not found.');
  const result = mutate(user);
  await store.setJSON(key, user);
  return result;
}

async function listAlertRules(email) {
  const store = usersStore();
  const user = await store.get(email.toLowerCase(), { type: 'json' });
  return (user && user.alertRules) || [];
}

async function createAlertRule(email, rule) {
  const { randomUUID } = require('crypto');
  const saved = {
    id: randomUUID(),
    ...rule,
    enabled: true,
    createdAt: new Date().toISOString()
  };
  await withUser(email, (user) => {
    user.alertRules = [saved, ...(user.alertRules || [])];
  });
  return saved;
}

async function updateAlertRule(email, ruleId, enabled) {
  await withUser(email, (user) => {
    const rule = (user.alertRules || []).find((r) => r.id === ruleId);
    if (rule) rule.enabled = enabled;
  });
}

async function deleteAlertRule(email, ruleId) {
  await withUser(email, (user) => {
    user.alertRules = (user.alertRules || []).filter((r) => r.id !== ruleId);
  });
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
