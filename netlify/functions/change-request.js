// "Managed by Leadly - ask Pulse to request a change": a client's ask from
// Pulse chat lands here as a change_request row for the workspace owner.
// (Email notification to the owner is pending an email provider - the same
// gap as alert delivery.)
const { getEmailFromRequest, getWorkspaceFromRequest, ensureWorkspace, createChangeRequest, listChangeRequests } = require('./_store');
const { demoGuard } = require('./_demoGuard');

exports.handler = async (event) => {
  const demoBlocked = demoGuard(event);
  if (demoBlocked) return demoBlocked;
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };

  try {
    let workspace = await getWorkspaceFromRequest(event.headers, email);

    if (event.httpMethod === 'GET') {
      if (!workspace.id) return json(200, { requests: [] });
      // the owner's inbox of open asks
      if (workspace.role !== 'owner') return { statusCode: 403, body: 'Owners only.' };
      const requests = await listChangeRequests(workspace.id);
      return json(200, { requests });
    }

    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
    if (!workspace.id) workspace = await ensureWorkspace(event.headers, email);
    const body = JSON.parse(event.body || '{}');
    if (!body.request || !String(body.request).trim()) {
      return json(400, { error: 'Say what you want changed.' });
    }
    await createChangeRequest(email, workspace.id, body);
    return json(200, { ok: true });
  } catch (err) {
    console.error(`[change-request] ${err.message}`);
    return json(400, { error: err.message });
  }
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
