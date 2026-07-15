// Retry ONE frame. Nothing else is touched - the other placements keep
// whatever they rendered.
const { getEmailFromRequest, getStudioRecord, putStudioRecord } = require('./_store');
const { advanceJob, json } = require('./_studio');

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
  try {
    const job = await getStudioRecord(email, 'job', String(b.jobId || ''));
    if (!job) return json(200, { error: 'No such job.' });
    if (!job.items[b.placement]) return json(200, { error: "That placement isn't in this job." });
    job.items[b.placement] = { state: 'queued', files: [], error: null };
    job.state = 'generating';
    await advanceJob(job);
    await putStudioRecord(email, 'job', job.id, job);
    return json(200, { ok: true });
  } catch (err) {
    console.error(`[studio-retry] ${err.message}`);
    return json(200, { error: err.message });
  }
};
