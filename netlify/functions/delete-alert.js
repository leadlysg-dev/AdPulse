// Delete an alert rule. Scoped to the logged-in user - the store layer
// matches on user id as well as rule id.
const { getEmailFromRequest, deleteAlertRule } = require('./_store');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const { id } = JSON.parse(event.body || '{}');
  if (typeof id !== 'string' || !id) return json(400, { error: 'Invalid request.' });

  await deleteAlertRule(email, id);
  return json(200, { ok: true });
};
