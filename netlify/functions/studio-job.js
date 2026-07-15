// Poll one job. Each call is one tick of the state machine: settle any
// finished fal requests, submit each placement's next step, and save.
// The browser polls this until the job settles.
const { getEmailFromRequest, getStudioRecord, putStudioRecord } = require('./_store');
const { advanceJob, json } = require('./_studio');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  const id = (event.queryStringParameters || {}).id || '';
  try {
    const job = await getStudioRecord(email, 'job', id);
    if (!job) return json(200, { error: 'No such job.' });
    if (job.state === 'queued' || job.state === 'generating') {
      await advanceJob(job);
      await putStudioRecord(email, 'job', job.id, job);
    }
    return json(200, { job });
  } catch (err) {
    console.error(`[studio-job] ${err.message}`);
    return json(200, { error: err.message });
  }
};
