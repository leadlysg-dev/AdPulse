// Mint a single-use invite link for a workspace. Owner only - the store
// enforces the role check against the database, not the request.
const { getEmailFromRequest, ensureWorkspace, createWorkspaceInvite } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid request.' };
  }
  try {
    // default to the active workspace when none is named
    const workspaceId = body.workspaceId || (await ensureWorkspace(event.headers, email)).id;
    const role = ['owner', 'agency', 'client', 'member'].includes(body.role) ? body.role : 'client';
    const token = await createWorkspaceInvite(email, workspaceId, role);
    const proto = event.headers['x-forwarded-proto'] || 'https';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        role,
        expiresInDays: 7,
        url: `${proto}://${event.headers.host}/invite.html?token=${encodeURIComponent(token)}`
      })
    };
  } catch (err) {
    console.error(`[invite-create] ${err.message}`);
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
