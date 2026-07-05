// Handles customer accounts (email + password), login sessions, and each
// customer's connected ad accounts. Everything is keyed by email, so a
// customer sees the same data no matter which device or browser they log in
// from - and can never see another customer's data.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getStore } = require('@netlify/blobs');

function usersStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: 'adpulse-users', siteID, token });
  }
  return getStore('adpulse-users');
}

// --- Passwords ---
// scrypt is built into Node - no extra dependency needed for safe password hashing.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(check));
}

// --- Users ---
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
    accounts: {} // provider -> { accessToken, refreshToken, adAccounts: [...], selectedAdAccountId }
  };
  await store.setJSON(key, user);
  return user;
}

async function saveUser(user) {
  const store = usersStore();
  await store.setJSON(user.email, user);
}

// --- Sessions (JWT stored in an httpOnly cookie) ---
function createSessionCookie(email) {
  const token = jwt.sign({ email }, process.env.SESSION_SECRET, { expiresIn: '30d' });
  return `adpulse_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

function clearSessionCookie() {
  return 'adpulse_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

function getEmailFromRequest(headers) {
  const cookie = headers.cookie || '';
  const match = cookie.match(/adpulse_session=([^;]+)/);
  if (!match) return null;
  try {
    const payload = jwt.verify(match[1], process.env.SESSION_SECRET);
    return payload.email;
  } catch {
    return null; // expired or tampered token
  }
}

module.exports = {
  getUser,
  createUser,
  saveUser,
  verifyPassword,
  createSessionCookie,
  clearSessionCookie,
  getEmailFromRequest
};
