// List this user's recent jobs, optionally scoped to one project - the
// Studio resumes the newest matching job when the tab (re)opens.
const { getEmailFromRequest, listStudioRecords } = require('./_store');
const { slug, json } = require('./_studio');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  const project = (event.queryStringParameters || {}).project || '';
  try {
    const jobs = await listStudioRecords(email, 'job', {
      idPrefix: project ? `${slug(project)}--` : '',
      limit: 30
    });
    jobs.sort((a, b) => b.created - a.created);
    return json(200, { jobs });
  } catch (err) {
    console.error(`[studio-jobs] ${err.message}`);
    return json(200, { jobs: [], unavailable: true });
  }
};
