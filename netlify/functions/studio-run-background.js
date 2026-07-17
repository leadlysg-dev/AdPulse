// Background worker (Netlify "-background" function: returns 202 at once,
// runs up to 15 minutes). Gated by a short-lived signed token minted by
// studio-generate - never by a session cookie.
const jwt = require('jsonwebtoken');
const store = require('./_store');
const { loadStudioKeys } = require('./_studioKeys');
const core = require('./_studioCore');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const payload = jwt.verify(body.token || '', process.env.SESSION_SECRET);
    if (payload.purpose !== 'studio-run' || !payload.jobId) throw new Error('bad token');
    const keys = await loadStudioKeys(store);
    const deps = process.env.STUDIO_MOCK === '1' ? core.makeMockDeps(store) : core.makeRealDeps(store, keys);
    await core.processJob(payload.jobId, deps);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error(`[studio-run-background] ${err.message}`);
    return { statusCode: 400, body: 'error' };
  }
};
