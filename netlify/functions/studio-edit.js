// Run an edit step on a chain. An edit never destroys its source: every
// step is kept, and any step can be branched from. The edit renders via
// fal's queue, so this returns a chain with a pending step - the browser
// polls studio-chain until it settles.
const { getEmailFromRequest, getStudioRecord, putStudioRecord } = require('./_store');
const { MODELS, MOCK, falSubmit, stamp, json } = require('./_studio');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  let b;
  try {
    b = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request.' });
  }
  const { src, instruction, refs = [], chainId, parent = null } = b;
  const n = Math.max(1, Math.min(3, +b.n || 1));
  if (!src || !instruction) return json(200, { error: 'Need a source image and an instruction.' });

  try {
    let chain = chainId ? await getStudioRecord(email, 'chain', chainId) : null;
    if (!chain) chain = { id: `chain--${stamp()}`, origin: src, steps: [], created: Date.now() };
    if (chain.pending) return json(200, { error: 'An edit is already running on this chain — wait for it to finish.' });
    chain.error = null;

    const pending = { instruction, src, refs, n, parent };
    if (!MOCK) {
      const input = MODELS['nano-banana-edit'].input(instruction, { image_urls: [src, ...refs] });
      pending.requests = [];
      for (let i = 0; i < n; i++) pending.requests.push(await falSubmit('fal-ai/nano-banana-pro/edit', input));
    }
    chain.pending = pending;
    await putStudioRecord(email, 'chain', chain.id, chain);
    return json(200, { chain });
  } catch (err) {
    console.error(`[studio-edit] ${err.message}`);
    return json(200, { error: err.message });
  }
};
