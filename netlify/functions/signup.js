// Public signup is closed: Leadly Pulse is invite-only. Accounts are created
// through single-use workspace invite links (invite-accept.js) minted by a
// workspace owner, or by Google sign-in for emails that already hold a
// membership. This handler stays so old clients get a clear answer instead
// of a 404.
exports.handler = async () => ({
  statusCode: 403,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    error: 'Leadly Pulse is invite-only. Ask your agency contact for an invite link.'
  })
});
