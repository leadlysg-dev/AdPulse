// The workspace's master metrics config, set once during onboarding and
// re-run only from Settings. Shape documented in migration 013. Defaults
// (Spend, CPM, Impressions, Ad Clicks, CTR, CPC) are always on client-side
// and never stored here.
const { getEmailFromRequest, getWorkspaceFromRequest, ensureWorkspace, getMetricsConfig, saveMetricsConfig, getUser, saveUser } = require('./_store');
const { demoGuard } = require('./_demoGuard');

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

// Build a master config from a connection's legacy selected_metrics rows:
// every selection becomes a tracked conversion, the first per platform
// becomes that platform's mapped result, named "Enquiries" until renamed.
async function migrateLegacySelections(email, workspaceId) {
  const user = await getUser(email);
  const legacy = [];
  for (const platform of ['meta', 'google']) {
    const conn = user && user.accounts && user.accounts[platform];
    for (const m of (conn && conn.selectedMetrics) || []) {
      legacy.push({ id: String(m.id), label: String(m.label || m.id), platform });
    }
  }
  if (!legacy.length) return null;
  const first = (platform) => legacy.find((c) => c.platform === platform);
  const config = {
    extras: [],
    conversions: legacy.slice(0, 20),
    primaryResult: {
      name: 'Enquiries',
      source: 'platform_event',
      meta: first('meta') ? { event: first('meta').id, label: first('meta').label } : null,
      google: first('google') ? { event: first('google').id, label: first('google').label } : null
    }
  };
  await saveMetricsConfig(workspaceId, config);
  return config;
}

exports.handler = async (event) => {
  const demoBlocked = demoGuard(event);
  if (demoBlocked) return demoBlocked;
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  try {
    const workspace = await getWorkspaceFromRequest(event.headers, email);
    if (event.httpMethod === 'GET') {
      let config = workspace.id ? await getMetricsConfig(workspace.id) : null;
      if (!config && workspace.id) {
        // One-time migration: selections that exist only in the legacy
        // per-platform system become the master config, so nobody is forced
        // back through onboarding just because the old edit screens went.
        config = await migrateLegacySelections(email, workspace.id);
      }
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
    // no membership yet (pre-011 account): make the workspace now rather
    // than trapping the user in onboarding they can never finish
    const target = workspace.id ? workspace : await ensureWorkspace(event.headers, email);
    await saveMetricsConfig(target.id, config);
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
