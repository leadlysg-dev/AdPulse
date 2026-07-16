// The workspace's tracked metrics - "what do you want to keep an eye on?".
// Drives the Pulse KPI cards and both tabs' table columns. Stored on the
// workspace row; the single-tenant fallback keeps it in memory per deploy.
const { getEmailFromRequest, getWorkspaceFromRequest, getTrackedMetrics, saveTrackedMetrics } = require('./_store');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  try {
    const workspace = await getWorkspaceFromRequest(event.headers, email);
    if (event.httpMethod === 'GET') {
      const metrics = workspace.id ? await getTrackedMetrics(workspace.id) : null;
      return json(200, { metrics: metrics || null });
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
    const body = JSON.parse(event.body || '{}');
    const metrics = Array.isArray(body.metrics)
      ? body.metrics.map((m) => String(m)).slice(0, 24)
      : null;
    if (!metrics || !metrics.length) return json(400, { error: 'Pick at least one metric.' });
    if (!workspace.id) return json(400, { error: 'No workspace - run migration 011 first.' });
    await saveTrackedMetrics(workspace.id, metrics);
    return json(200, { ok: true, metrics });
  } catch (err) {
    console.error(`[tracked-metrics] ${err.message}`);
    return json(400, { error: err.message });
  }
};
