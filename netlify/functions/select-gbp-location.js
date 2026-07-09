// Persists which Business Profile location the SEO tab reports on.
const { getEmailFromRequest, getUser, saveUser } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  const { locationId } = JSON.parse(event.body || '{}');
  const user = await getUser(email);
  const gbp = user && user.accounts.gbp;
  if (!gbp) return { statusCode: 400, body: 'Business Profile is not connected yet.' };
  if (!(gbp.adAccounts || []).some((l) => l.id === locationId)) {
    return { statusCode: 400, body: 'That location is not on this connection.' };
  }
  gbp.selectedAdAccountId = locationId;
  await saveUser(user);
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
};
