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

async function createUser(email, password) {
  const store = usersStore();
  const key = email.toLowerCase();
  const existing = await store.get(key, { type: 'json' });
  if (existing) throw new Error('An account with that email already exists.');
  const user = {
    email: key,
    passwordHash: hashPassword(password),
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

module.exports = { getUser, createUser, saveUser };
