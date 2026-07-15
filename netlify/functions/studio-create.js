// Start a generation job. Returns immediately with a job id; the state
// machine lives in the store and the browser's poll (studio-job) advances
// it - fal renders via its queue, so nothing here ever blocks.
const { getEmailFromRequest, getStudioRecord, putStudioRecord } = require('./_store');
const { newJob, advanceJob, MODELS, json } = require('./_studio');

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
  if (!b.prompt) return json(200, { error: 'Write a prompt first.' });
  if (!b.placements || !b.placements.length) return json(200, { error: 'Tick at least one placement.' });
  if (!MODELS[b.model]) return json(200, { error: 'Unknown model: ' + b.model });

  try {
    // Docs and brand text are read once here and baked into the per-placement
    // prompts, so the poll loop never re-reads documents.
    const docTexts = {};
    for (const name of b.docs || []) {
      const doc = await getStudioRecord(email, 'doc', name);
      if (doc && doc.text) docTexts[name] = doc.text;
    }
    let brandText = null;
    if (b.brand) {
      const brand = await getStudioRecord(email, 'brand', b.brand);
      if (brand && brand.text) brandText = brand.text;
    }

    const job = newJob(b, docTexts, brandText);
    await advanceJob(job); // submit the first fal request per placement
    await putStudioRecord(email, 'job', job.id, job);
    return json(200, { jobId: job.id });
  } catch (err) {
    console.error(`[studio-create] ${err.message}`);
    return json(200, { error: err.message });
  }
};
