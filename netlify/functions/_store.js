// Shared helper for reading/writing each customer's connected-account tokens.
// Uses Netlify Blobs - a built-in key/value store, no extra database to set up.
const { getStore } = require('@netlify/blobs');

function accountsStore() {
  return getStore('adpulse-accounts');
}

// Each customer is identified by a simple session id stored in their browser cookie.
// This function reads that id from the request, or creates a new one.
function getOrCreateSessionId(headers) {
  const cookie = headers.cookie || '';
  const match = cookie.match(/adpulse_sid=([a-zA-Z0-9-]+)/);
  if (match) return { sid: match[1], isNew: false };
  const sid = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return { sid, isNew: true };
}

function sessionCookie(sid) {
  return `adpulse_sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
}

async function saveTokens(sid, provider, tokenData) {
  const store = accountsStore();
  const existingRaw = await store.get(sid, { type: 'json' });
  const existing = existingRaw || {};
  existing[provider] = { ...tokenData, connectedAt: new Date().toISOString() };
  await store.setJSON(sid, existing);
}

async function getTokens(sid) {
  const store = accountsStore();
  const data = await store.get(sid, { type: 'json' });
  return data || {};
}

module.exports = { getOrCreateSessionId, sessionCookie, saveTokens, getTokens };
