// Peek at an invite token for the accept page: valid / used / expired, plus
// the workspace name and the role it grants. Never claims the token.
const { getWorkspaceInvite } = require('./_store');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const token = (event.queryStringParameters || {}).token;
  if (!token) return json(400, { error: 'Missing invite token.' });
  try {
    const invite = await getWorkspaceInvite(token);
    if (!invite) return json(200, { state: 'invalid' });
    if (invite.used) return json(200, { state: 'used' });
    if (invite.expired) return json(200, { state: 'expired' });
    return json(200, { state: 'valid', workspaceName: invite.workspaceName, role: invite.role });
  } catch (err) {
    console.error(`[invite-info] ${err.message}`);
    return json(400, { error: err.message });
  }
};
