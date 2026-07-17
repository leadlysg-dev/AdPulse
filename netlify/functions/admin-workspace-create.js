// Create a client workspace and mint its single-use owner invite link in
// one step. Admin only.
const { requireAdmin, json } = require('./_admin');
const { createWorkspace, createWorkspaceInvite, writeAudit } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const gate = await requireAdmin(event);
  if (gate.response) return gate.response;
  try {
    const body = JSON.parse(event.body || '{}');
    const name = String(body.name || '').trim();
    if (!name) return json(400, { error: 'Give the workspace a name.' });
    const workspace = await createWorkspace(name, body.managed !== false);
    const token = await createWorkspaceInvite(gate.email, workspace.id, 'owner');
    await writeAudit(gate.email, 'workspace_created', workspace.id, { name, managed: body.managed !== false });
    const proto = event.headers['x-forwarded-proto'] || 'https';
    return json(200, {
      workspace,
      invite: {
        token,
        url: `${proto}://${event.headers.host}/invite.html?token=${encodeURIComponent(token)}`,
        role: 'owner',
        expiresInDays: 7
      }
    });
  } catch (err) {
    console.error(`[admin-workspace-create] ${err.message}`);
    return json(400, { error: err.message });
  }
};
