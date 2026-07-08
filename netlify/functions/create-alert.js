// Saves one alert rule directly (the preset cards) - no AI involved. The
// same validation and description the assistant's tool path uses.
const { getEmailFromRequest, getUser, createAlertRule } = require('./_store');
const { describeRule, validRule } = require('./_alerts');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid request body.' };
  }
  if (typeof input.threshold === 'string') input.threshold = Number(input.threshold);
  if (!validRule(input)) return { statusCode: 400, body: 'That alert is not valid - check the value.' };

  const user = await getUser(email);
  if (!user) return { statusCode: 401, body: 'Not logged in.' };

  const rule = await createAlertRule(email, {
    metric: input.metric,
    channel: input.channel,
    comparison: input.comparison,
    threshold: input.threshold,
    timeframe: input.timeframe,
    description: describeRule(input)
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, rule })
  };
};
