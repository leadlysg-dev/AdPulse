// Shared gate for platform-admin endpoints: resolves the session AND
// verifies the platform_admin row server-side. Never trust the client.
const { getEmailFromRequest, isPlatformAdmin } = require('./_store');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

// Returns { email } on success, or { response } to return as-is.
async function requireAdmin(event) {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { response: json(401, { error: 'Not logged in.' }) };
  const admin = await isPlatformAdmin(email);
  if (!admin) return { response: json(403, { error: 'Leadly platform admins only.' }) };
  return { email };
}

module.exports = { requireAdmin, json };
