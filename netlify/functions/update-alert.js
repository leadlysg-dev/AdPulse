// Toggle an alert rule on or off. Scoped to the logged-in user - the store
// layer matches on user id as well as rule id.
const { getEmailFromRequest, updateAlertRule } = require('./_store');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const { id, enabled } = JSON.parse(event.body || '{}');
  if (typeof id !== 'string' || !id || typeof enabled !== 'boolean') {
    return json(400, { error: 'Invalid request.' });
  }

  await updateAlertRule(email, id, enabled);
  return json(200, { ok: true });
};
