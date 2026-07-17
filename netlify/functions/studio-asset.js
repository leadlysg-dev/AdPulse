// Per-asset actions. edit_overlay re-composites from the stored base image
// and sidecar - no image model call, no new charge. save flags the asset
// for the library. retry re-runs ONE failed placement frame without
// touching (or re-charging) the others.
const store = require('./_store');
const core = require('./_studioCore');
const { loadStudioKeys } = require('./_studioKeys');

const MOCK = () => process.env.STUDIO_MOCK === '1';
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const email = store.getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });
  try {
    const body = JSON.parse(event.body || '{}');
    const workspace = await store.getWorkspaceFromRequest(event.headers, email);
    if (!workspace.id) return json(400, { error: 'No workspace.' });
    const keys = await loadStudioKeys(store);
    const deps = MOCK() ? core.makeMockDeps(store) : core.makeRealDeps(store, keys);

    if (body.action === 'edit_overlay' || body.action === 'save') {
      const metaPath = String(body.metaPath || '');
      if (!metaPath.startsWith(`ws/${workspace.id}/`)) return json(404, { error: 'No such asset in this workspace.' });
      const meta = JSON.parse((await deps.storageGet(metaPath)).toString('utf8'));
      if (meta.workspaceId !== workspace.id) return json(404, { error: 'No such asset in this workspace.' });

      if (body.action === 'save') {
        meta.saved = true;
        await deps.storagePut(metaPath, Buffer.from(JSON.stringify(meta)), 'application/json');
        return json(200, { ok: true });
      }

      const text = String(body.text || '').trim();
      if (!text) return json(400, { error: 'Overlay text cannot be empty.' });
      if (text.length > core.OVERLAY_MAX) return json(400, { error: `Overlay text is capped at ${core.OVERLAY_MAX} characters.` });
      const base = await deps.storageGet(meta.basePath);
      const composed = await core.compose({
        baseImage: base,
        templateId: meta.overlay.templateId,
        text,
        brandKit: meta.overlay.brandKit,
        placementId: meta.placementId,
        scrim: meta.overlay.scrim
      });
      const url = await deps.storagePut(meta.outPath, composed.png, 'image/png');
      meta.overlay = composed.overlay;
      await deps.storagePut(metaPath, Buffer.from(JSON.stringify(meta)), 'application/json');
      return json(200, { ok: true, url, text });
    }

    if (body.action === 'retry') {
      const job = await store.getStudioJobById(String(body.jobId || ''), workspace.id);
      if (!job) return json(404, { error: 'No such job in this workspace.' });
      const key = String(body.key || '');
      if (!job.placements || !job.placements[key]) return json(400, { error: 'Unknown frame.' });
      job.placements[key] = { status: 'queued' };
      await store.updateStudioJob(job.id, { placements: job.placements, status: 'generating' });
      // processJob skips frames already done, so only this frame re-runs -
      // and no new ledger row is written.
      const result = await core.processJob(job.id, deps);
      return json(200, { ok: true, status: result.status, placements: result.placements });
    }

    return json(400, { error: 'Unknown action.' });
  } catch (err) {
    console.error(`[studio-asset] ${err.message}`);
    return json(400, { error: err.message });
  }
};
