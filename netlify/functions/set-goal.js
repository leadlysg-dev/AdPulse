// Sets or clears the optional cost-per-result target on one tracked metric
// ("cost per lead under $30"). POST { provider, metricId, targetCostPer }
// where targetCostPer is a positive number, or null to remove the target.
const { getEmailFromRequest, getUser, saveUser } = require('./_store');

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

  const { provider, metricId, targetCostPer } = body;
  if (!['meta', 'google'].includes(provider) || typeof metricId !== 'string' || !metricId) {
    return { statusCode: 400, body: 'Missing provider or metricId.' };
  }
  const clearing = targetCostPer === null;
  const target = Number(targetCostPer);
  if (!clearing && (!Number.isFinite(target) || target <= 0 || target > 1000000)) {
    return { statusCode: 400, body: 'Target must be a positive amount, or null to remove it.' };
  }

  const user = await getUser(email);
  const account = user.accounts[provider];
  if (!account) return { statusCode: 400, body: `${provider} is not connected yet.` };

  const metric = (account.selectedMetrics || []).find((m) => m.id === metricId);
  if (!metric) return { statusCode: 400, body: 'That metric is not in your tracked selection.' };

  if (clearing) delete metric.targetCostPer;
  else metric.targetCostPer = +target.toFixed(2);

  await saveUser(user);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true })
  };
};
