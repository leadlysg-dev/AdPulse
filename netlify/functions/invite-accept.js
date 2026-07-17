// Accept a single-use invite: creates the 'client' account (or attaches an
// existing account as a client), claims the token, and signs the user in.
// The invite token is the only way to create an account - public signup
// is closed.
const {
  getUser,
  getEmailFromRequest,
  verifyPassword,
  hasSetPassword,
  acceptWorkspaceInvite,
  createSessionCookie,
  workspaceCookie
} = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid request.' };
  }
  const { token, email, password } = body;
  if (!token) return json(400, { error: 'Missing invite token.' });
  if (!email || !password || password.length < 8) {
    return json(400, { error: 'Enter an email and a password of at least 8 characters.' });
  }
  try {
    // If the email already has an account, the invite must not become a way
    // to take it over: the caller has to prove they own it, exactly like
    // logging in. Only then is the membership attached and a session issued.
    const existing = await getUser(email.toLowerCase());
    const sessionEmail = getEmailFromRequest(event.headers);
    const alreadyLoggedIn = existing && sessionEmail === email.toLowerCase();
    if (existing && !alreadyLoggedIn && (!hasSetPassword(existing) || !verifyPassword(password, existing.passwordHash))) {
      return json(403, {
        error:
          'An account with that email already exists. Enter its password to join the workspace, or log in first and open the invite link again.'
      });
    }

    const { workspaceId, created, role } = await acceptWorkspaceInvite(token, email.toLowerCase(), password);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      multiValueHeaders: {
        'Set-Cookie': [createSessionCookie(email.toLowerCase()), workspaceCookie(workspaceId)]
      },
      body: JSON.stringify({ ok: true, created, role })
    };
  } catch (err) {
    console.error(`[invite-accept] ${err.message}`);
    return json(400, { error: err.message });
  }
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
