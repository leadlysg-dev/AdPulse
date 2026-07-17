// The workspace's master metrics config, set once during onboarding and
// re-run only from Settings. Shape documented in migration 013. Defaults
// (Spend, CPM, Impressions, Ad Clicks, CTR, CPC) are always on client-side
// and never stored here.
const { getEmailFromRequest, getWorkspaceFromRequest, getMetricsConfig, saveMetricsConfig, getUser, saveUser } = require('./_store');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Keep each connection's selected_metrics in lockstep with the config:
// primary result first (get-report and get-manage-tree treat metrics[0] as
// the headline), then every other chosen conversion for that platform. A
// platform with nothing chosen keeps whatever it had.
async function syncConnections(email, config) {
  const user = await getUser(email);
  if (!user) return;
  let changed = false;
  for (const platform of ['meta', 'google']) {
    const conn = user.accounts && user.accounts[platform];
    if (!conn) continue;
    const list = [];
    const prim = config.primaryResult[platform];
    if (prim) list.push({ id: prim.event, label: prim.label || prim.event });
    for (const cv of config.conversions.filter((c) => c.platform === platform)) {
      if (!list.some((m) => m.id === cv.id)) list.push({ id: cv.id, label: cv.label });
    }
    if (list.length) {
      conn.selectedMetrics = list;
      changed = true;
    }
  }
  if (changed) await saveUser(user);
}

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  try {
    const workspace = await getWorkspaceFromRequest(event.headers, email);
    if (event.httpMethod === 'GET') {
      const config = workspace.id ? await getMetricsConfig(workspace.id) : null;
      return json(200, { config: config || null });
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
    if (workspace.role === 'client') return json(403, { error: 'Metrics setup is managed by Leadly for this workspace.' });
    const body = JSON.parse(event.body || '{}');
    const c = body.config;
    if (!c || typeof c !== 'object' || !c.primaryResult || !c.primaryResult.name) {
      return json(400, { error: 'Finish the setup first — a result name is required.' });
    }
    const config = {
      extras: Array.isArray(c.extras) ? c.extras.map(String).slice(0, 10) : [],
      conversions: Array.isArray(c.conversions)
        ? c.conversions.slice(0, 20).map((x) => ({ id: String(x.id), label: String(x.label || x.id), platform: x.platform === 'google' ? 'google' : 'meta' }))
        : [],
      primaryResult: {
        name: String(c.primaryResult.name).slice(0, 40),
        source: c.primaryResult.source === 'crm_verified' ? 'crm_verified' : 'platform_event',
        meta: c.primaryResult.meta ? { event: String(c.primaryResult.meta.event), label: String(c.primaryResult.meta.label || '') } : null,
        google: c.primaryResult.google ? { event: String(c.primaryResult.google.event), label: String(c.primaryResult.google.label || '') } : null
      }
    };
    if (!workspace.id) return json(400, { error: 'No workspace - run migration 011 first.' });
    await saveMetricsConfig(workspace.id, config);
    await syncConnections(email, config).catch((err) => console.error(`[metrics-config] sync failed: ${err.message}`));
    return json(200, { ok: true, config });
  } catch (err) {
    console.error(`[metrics-config] ${err.message}`);
    // The one setup step this can't survive: the column doesn't exist yet.
    if (/metrics_config.*(column|schema cache)/i.test(err.message)) {
      return json(400, {
        error:
          "One database update is missing: open Supabase → SQL editor and run supabase-migrations/013-metrics-config.sql (a single ALTER TABLE), then press Finish setup again."
      });
    }
    return json(400, { error: err.message });
  }
};
