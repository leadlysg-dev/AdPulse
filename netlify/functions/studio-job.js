// One job's live state, strictly scoped to the caller's active workspace -
// a job id from another workspace 404s. The UI polls this; per-placement
// state (queued/generating/done/error + urls + the QA rung used) rides in
// placements.
const { getEmailFromRequest, getWorkspaceFromRequest, getStudioJobById } = require('./_store');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });
  try {
    const workspace = await getWorkspaceFromRequest(event.headers, email);
    if (!workspace.id) return json(400, { error: 'No workspace.' });
    const id = (event.queryStringParameters || {}).id;
    if (!id) return json(400, { error: 'Which job?' });
    const job = await getStudioJobById(id, workspace.id);
    if (!job) return json(404, { error: 'No such job in this workspace.' });
    return json(200, { job: { id: job.id, status: job.status, cost: job.cost, model: job.model, templateId: job.templateId, placements: job.placements, createdAt: job.createdAt } });
  } catch (err) {
    console.error(`[studio-job] ${err.message}`);
    return json(400, { error: err.message });
  }
};
