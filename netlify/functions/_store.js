// Handles customer accounts (email + password), login sessions, and each
// customer's connected ad accounts. Everything is keyed by email, so a
// customer sees the same data no matter which device or browser they log in
// from - and can never see another customer's data.
//
// Storage lives in Supabase Postgres (_store-supabase.js). The original
// Netlify Blobs backend (_store-blobs.js) is kept as a fallback: set
// STORAGE_BACKEND=blobs in Netlify's environment variables to switch back
// without touching code. Sessions are stateless JWTs and never touch
// storage, so they work identically on both backends.
const jwt = require('jsonwebtoken');
const { verifyPassword } = require('./_password');

const backend =
  process.env.STORAGE_BACKEND === 'blobs'
    ? require('./_store-blobs')
    : require('./_store-supabase');

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
  getUser: backend.getUser,
  createUser: backend.createUser,
  saveUser: backend.saveUser,
  verifyPassword,
  createSessionCookie,
  clearSessionCookie,
  getEmailFromRequest
};
