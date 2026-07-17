// "Enter workspace" from the admin directory: logs an admin_session row and
// switches the admin's active-workspace cookie. The cookie alone never
// grants access - getWorkspaceFromRequest re-verifies platform_admin on
// every request that presents a foreign workspace id.
const { requireAdmin, json } = require('./_admin');
const { getWorkspaceById, createAdminSession, writeAudit, workspaceCookie } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const gate = await requireAdmin(event);
  if (gate.response) return gate.response;
  try {
    const body = JSON.parse(event.body || '{}');
    const workspace = await getWorkspaceById(String(body.workspaceId || ''));
    if (!workspace) return json(404, { error: 'No such workspace.' });
    const sessionId = await createAdminSession(gate.email, workspace.id);
    await writeAudit(gate.email, 'admin_entered_workspace', workspace.id, { sessionId });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': workspaceCookie(workspace.id) },
      body: JSON.stringify({ ok: true, sessionId, workspace: { id: workspace.id, name: workspace.name } })
    };
  } catch (err) {
    console.error(`[admin-enter] ${err.message}`);
    return json(400, { error: err.message });
  }
};
