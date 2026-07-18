// Members of the active workspace: list, add a Leadly teammate by email
// (agency role), remove a member. Owners, agency members, and platform
// admins only - verified against the database, never the request.
const {
  getEmailFromRequest,
  ensureWorkspace,
  listWorkspaceMembers,
  addWorkspaceMember,
  removeWorkspaceMember,
  writeAudit
} = require('./_store');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });
  try {
    const workspace = await ensureWorkspace(event.headers, email);
    const canManage = workspace.role === 'owner' || workspace.role === 'agency' || workspace.adminView;
    if (!canManage) return json(403, { error: 'Only owners and Leadly can manage members.' });

    if (event.httpMethod === 'GET') {
      const members = await listWorkspaceMembers(workspace.id);
      return json(200, { members, workspace: { id: workspace.id, name: workspace.name } });
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };

    const body = JSON.parse(event.body || '{}');
    const target = String(body.email || '').trim().toLowerCase();
    if (!target) return json(400, { error: 'Which email?' });

    if (body.action === 'add') {
      const role = body.role === 'agency' ? 'agency' : 'client';
      await addWorkspaceMember(workspace.id, target, role);
      await writeAudit(email, 'member_added', workspace.id, { email: target, role });
    } else if (body.action === 'remove') {
      await removeWorkspaceMember(workspace.id, target);
      await writeAudit(email, 'member_removed', workspace.id, { email: target });
    } else {
      return json(400, { error: 'Unknown action.' });
    }
    const members = await listWorkspaceMembers(workspace.id);
    return json(200, { ok: true, members });
  } catch (err) {
    console.error(`[workspace-members] ${err.message}`);
    return json(400, { error: err.message });
  }
};
