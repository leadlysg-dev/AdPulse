// The gallery: workspace-scoped storage is the only source of truth. Every
// composite writes a sidecar JSON next to its PNG; listing the workspace's
// folder and reading the sidecars IS the gallery.
const store = require('./_store');
const core = require('./_studioCore');

const MOCK = () => process.env.STUDIO_MOCK === '1';
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const email = store.getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });
  try {
    const workspace = await store.getWorkspaceFromRequest(event.headers, email);
    if (!workspace.id) return json(200, { assets: [] });
    const deps = MOCK() ? core.makeMockDeps(store) : core.makeRealDeps(store, null);
    const prefix = `ws/${workspace.id}/`;
    const entries = await deps.storageList(prefix);
    const metaNames = entries
      .map((e) => e.name)
      .filter((n) => n.endsWith('.json') && !n.startsWith('refs/'))
      .slice(0, 80);
    const assets = [];
    for (const name of metaNames) {
      try {
        const meta = JSON.parse((await deps.storageGet(prefix + name)).toString('utf8'));
        if (meta.workspaceId !== workspace.id) continue;
        assets.push({
          metaPath: prefix + name,
          path: meta.outPath,
          url: MOCK() ? `mock://storage/${meta.outPath}` : core.publicUrl(meta.outPath),
          placementId: meta.placementId,
          overlay: { templateId: meta.overlay.templateId, text: meta.overlay.text },
          rung: meta.rung,
          saved: !!meta.saved,
          jobId: meta.jobId,
          createdAt: meta.createdAt
        });
      } catch {
        // unreadable sidecar - skip the asset rather than break the wall
      }
    }
    assets.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return json(200, { assets });
  } catch (err) {
    console.error(`[studio-gallery] ${err.message}`);
    return json(400, { error: err.message });
  }
};
