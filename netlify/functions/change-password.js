// Change (or first-time set) the logged-in user's password. Users who set a
// password before must prove they know the current one; accounts created by
// Google sign-in only hold an unguessable placeholder, so for them the
// logged-in session itself is the proof and no current password is asked.
// Sessions are stateless JWTs keyed by email, so existing sessions stay
// valid after the change.
const {
  getEmailFromRequest,
  getUser,
  hasSetPassword,
  verifyPassword,
  setPassword
} = require('./_store');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const { currentPassword, newPassword } = JSON.parse(event.body || '{}');
  if (!newPassword || newPassword.length < 8) {
    return json(400, { error: 'New password must be at least 8 characters.' });
  }

  const user = await getUser(email);
  if (!user) return json(401, { error: 'Not logged in.' });

  if (hasSetPassword(user)) {
    if (!currentPassword || !verifyPassword(currentPassword, user.passwordHash)) {
      return json(401, { error: 'Current password is incorrect.' });
    }
  }

  await setPassword(email, newPassword);
  return json(200, { ok: true });
};
