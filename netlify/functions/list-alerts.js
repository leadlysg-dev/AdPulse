// The logged-in user's alert rules, newest first.
const { getEmailFromRequest, listAlertRules } = require('./_store');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Not logged in.' }) };
  }

  const rules = await listAlertRules(email);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules })
  };
};
