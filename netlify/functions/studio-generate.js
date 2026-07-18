// Generate: the four inputs in, an async job out. Validates the unlock and
// the monthly budget, extracts uploaded file text server-side, uploads the
// reference images, has Claude write the machine spec (never seeing the
// refs, never seeing the overlay wording), charges the ledger, and starts
// processing - synchronously under STUDIO_MOCK, else via the background
// function.
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const crypto = require('crypto');
const store = require('./_store');
const { loadStudioKeys } = require('./_studioKeys');
const core = require('./_studioCore');
const { demoGuard } = require('./_demoGuard');

const MOCK = () => process.env.STUDIO_MOCK === '1';
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function extractFileText(file) {
  if (!file || !file.data) return '';
  const name = String(file.name || '').toLowerCase();
  const buf = Buffer.from(String(file.data).replace(/^data:[^,]*,/, ''), 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('That file is too large (8 MB max).');
  if (/\.pdf$/.test(name)) {
    const pdf = require('pdf-parse');
    const out = await pdf(buf);
    return String(out.text || '').slice(0, 20000);
  }
  if (/\.(md|txt|csv|json)$/.test(name)) return buf.toString('utf8').slice(0, 20000);
  throw new Error('Only .md, .txt, .csv, .json and .pdf files are supported.');
}

exports.handler = async (event) => {
  const demoBlocked = demoGuard(event);
  if (demoBlocked) return demoBlocked;
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const email = store.getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });
  try {
    const body = JSON.parse(event.body || '{}');
    let workspace = await store.getWorkspaceFromRequest(event.headers, email);
    if (!workspace.id) workspace = await store.ensureWorkspace(event.headers, email);

    const studio = await store.getWorkspaceStudio(workspace.id);
    if (!studio.enabled) return json(403, { error: "Studio isn't unlocked for this workspace yet - ask Leadly." });

    // ---- validate the four inputs ----
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return json(400, { error: 'Describe the ad you want - a line is enough.' });
    const overlayText = String(body.overlayText || '').trim();
    if (overlayText.length > core.OVERLAY_MAX) {
      return json(400, { error: `Overlay text is capped at ${core.OVERLAY_MAX} characters - short sells.` });
    }
    const refs = Array.isArray(body.refs) ? body.refs.slice(0, 3) : [];
    const templateId = core.templateById(body.templateId) ? body.templateId : 'open-left';
    const template = core.templateById(templateId);
    const placementIds = (Array.isArray(body.placements) ? body.placements : []).filter((p) => core.PLACEMENTS[p]);
    if (!placementIds.length) return json(400, { error: 'Pick at least one placement.' });
    const variants = Math.min(4, Math.max(1, parseInt(body.variants, 10) || 1));
    const modelId = core.MODELS[body.model] ? body.model : 'nano-banana-pro';

    // ---- keys: degrade cleanly when the platform isn't configured ----
    const keys = await loadStudioKeys(store);
    if (!MOCK() && (!keys.fal || !keys.anthropic)) {
      return json(503, { error: "Studio isn't configured yet - Leadly needs to add its API keys in the admin settings." });
    }

    // ---- budget ----
    const cost = +(placementIds.length * variants * core.MODELS[modelId].price).toFixed(2);
    const monthSpend = await store.getMonthSpend(workspace.id).catch(() => 0);
    const remaining = +(studio.budget - monthSpend).toFixed(2);
    if (cost > remaining) {
      return json(402, {
        error: `This job needs $${cost.toFixed(2)} of credit but only $${Math.max(0, remaining).toFixed(2)} is left this month.`,
        cost,
        remaining: Math.max(0, remaining)
      });
    }

    const deps = MOCK() ? core.makeMockDeps(store) : core.makeRealDeps(store, keys);

    // ---- file text (server-side extraction) + reference uploads ----
    const fileText = await extractFileText(body.file);
    const refUrls = [];
    for (const dataUrl of refs) {
      const m = String(dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
      if (!m) continue;
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 8 * 1024 * 1024) return json(400, { error: 'Reference images are capped at 8 MB each.' });
      const path = `ws/${workspace.id}/refs/${crypto.randomBytes(6).toString('hex')}.png`;
      refUrls.push(await deps.storagePut(path, buf, m[1]));
    }

    // ---- Claude writes the spec (text-only; refs and wording never sent) ----
    const spec = await core.writeSpec(
      {
        prompt,
        fileText,
        overlayLen: overlayText.length,
        template,
        model: modelId,
        placements: placementIds,
        hasRefs: refUrls.length > 0
      },
      deps
    );

    // ---- job + charge ----
    const placements = {};
    for (const pid of placementIds) for (let v = 1; v <= variants; v++) placements[`${pid}:${v}`] = { status: 'queued' };
    const jobId = await store.createStudioJob({
      workspaceId: workspace.id,
      status: 'queued',
      cost,
      model: modelId,
      templateId,
      spec,
      inputs: { prompt: prompt.slice(0, 2000), overlayText, refUrls, fileName: body.file ? body.file.name : null, brandKit: studio.brandKit },
      placements
    });
    await store.addStudioSpend(workspace.id, jobId, cost, `${modelId} x${Object.keys(placements).length}`);

    if (MOCK()) {
      const result = await core.processJob(jobId, deps);
      return json(200, { jobId, cost, status: result.status });
    }

    const token = jwt.sign({ jobId, purpose: 'studio-run' }, process.env.SESSION_SECRET, { expiresIn: '30m' });
    const proto = event.headers['x-forwarded-proto'] || 'https';
    await fetch(`${proto}://${event.headers.host}/.netlify/functions/studio-run-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    }).catch((err) => console.error(`[studio-generate] background kick failed: ${err.message}`));
    return json(200, { jobId, cost, status: 'queued' });
  } catch (err) {
    console.error(`[studio-generate] ${err.message}`);
    return json(400, { error: err.message });
  }
};
