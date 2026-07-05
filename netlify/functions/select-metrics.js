// Saves the customer's tracked-metric selection, stored as
// selectedMetrics = [{ id, label, targetCostPer? }] alongside the ad
// account they picked. Re-saving the selection keeps any cost-per targets
// already set on metrics that survive the edit.
const { getEmailFromRequest, getUser, saveUser } = require('./_store');
const { canonicalKeyFor } = require('./_metrics');

const MAX_METRICS = 10;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid request body.' };
  }

  const { provider, metrics } = body;
  if (!['meta', 'google'].includes(provider)) {
    return { statusCode: 400, body: 'Unknown provider.' };
  }
  if (!Array.isArray(metrics) || metrics.length === 0 || metrics.length > MAX_METRICS) {
    return { statusCode: 400, body: `Pick between 1 and ${MAX_METRICS} metrics.` };
  }

  const cleaned = [];
  for (const m of metrics) {
    if (!m || typeof m.id !== 'string' || typeof m.label !== 'string') {
      return { statusCode: 400, body: 'Each metric needs an id and a label.' };
    }
    const id = m.id.trim();
    const label = m.label.trim().slice(0, 60);
    if (!id || !label || id.length > 120) {
      return { statusCode: 400, body: 'Each metric needs an id and a label.' };
    }
    if (!cleaned.some((c) => c.id === id)) cleaned.push({ id, label });
  }

  const user = await getUser(email);
  if (!user.accounts[provider]) {
    return { statusCode: 400, body: `${provider} is not connected yet.` };
  }

  // Keep existing cost-per targets for metrics that survive the edit.
  // Match by canonical identity, since a re-pick can store a different
  // alias of the same conversion.
  const previous = user.accounts[provider].selectedMetrics || [];
  cleaned.forEach((m) => {
    const prior = previous.find((p) => canonicalKeyFor(p.id) === canonicalKeyFor(m.id));
    if (prior && prior.targetCostPer != null) m.targetCostPer = prior.targetCostPer;
  });

  user.accounts[provider].selectedMetrics = cleaned;
  await saveUser(user);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true })
  };
};
