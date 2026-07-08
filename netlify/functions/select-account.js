const { getEmailFromRequest, getUser, saveUser, clearAiInsightCache } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };

  const { provider, accountId } = JSON.parse(event.body || '{}');
  if (!['meta', 'google'].includes(provider) || !accountId) {
    return { statusCode: 400, body: 'Missing provider or accountId.' };
  }

  const user = await getUser(email);
  if (!user.accounts[provider]) return { statusCode: 400, body: `${provider} is not connected yet.` };

  user.accounts[provider].selectedAdAccountId = accountId;
  await saveUser(user);
  // Fresh connection state -> stale insights; wipe so the next view regenerates.
  await clearAiInsightCache(email).catch(() => {});

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
};
