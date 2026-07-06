// Disconnects Meta or Google from the logged-in user's account: removes the
// provider from the user record and saves, which the store layer already
// translates into deleting that provider's connection row (and, by cascade,
// its ad-account list, tracked metrics, and goals). Reconnecting later goes
// through the existing auth-meta / auth-google OAuth flows unchanged.
const { getEmailFromRequest, getUser, saveUser } = require('./_store');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const { provider } = JSON.parse(event.body || '{}');
  if (provider !== 'meta' && provider !== 'google') {
    return json(400, { error: 'Unknown provider.' });
  }

  const user = await getUser(email);
  if (!user) return json(401, { error: 'Not logged in.' });

  if (user.accounts[provider]) {
    delete user.accounts[provider];
    await saveUser(user);
  }

  return json(200, { ok: true });
};
