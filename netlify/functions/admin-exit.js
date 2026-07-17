// Leave an entered workspace: close the open admin_session rows and point
// the cookie back at the admin's own first workspace.
const { requireAdmin, json } = require('./_admin');
const { endAdminSessions, writeAudit, listMemberships, workspaceCookie } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const gate = await requireAdmin(event);
  if (gate.response) return gate.response;
  try {
    await endAdminSessions(gate.email);
    await writeAudit(gate.email, 'admin_exited_workspace', null, null);
    const memberships = await listMemberships(gate.email).catch(() => []);
    const home = memberships[0] ? memberships[0].id : '';
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': home ? workspaceCookie(home) : 'leadly_ws=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
      },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error(`[admin-exit] ${err.message}`);
    return json(400, { error: err.message });
  }
};
