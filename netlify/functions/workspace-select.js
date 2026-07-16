// Switch the active workspace. The choice only sticks if the user actually
// belongs to the requested workspace - the cookie is set from the validated
// membership, never from raw input.
const { getEmailFromRequest, listMemberships, workspaceCookie } = require('./_store');

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
    const memberships = await listMemberships(email);
    const target = memberships.find((m) => m.id === body.workspaceId);
    if (!target) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: "You don't belong to that workspace." })
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': workspaceCookie(target.id) },
      body: JSON.stringify({ ok: true, active: target })
    };
  } catch (err) {
    console.error(`[workspace-select] ${err.message}`);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
