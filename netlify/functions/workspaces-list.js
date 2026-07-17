// The workspaces this user belongs to, plus which one is active. Drives the
// sidebar switcher (owners) and role gating everywhere; single-workspace
// clients get one entry and the UI hides the switcher.
const { getEmailFromRequest, getWorkspaceFromRequest } = require('./_store');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  try {
    const active = await getWorkspaceFromRequest(event.headers, email);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        active: {
          id: active.id,
          name: active.name,
          role: active.role,
          billingExempt: active.billingExempt,
          managed: active.managed !== false,
          adminView: !!active.adminView
        },
        workspaces: active.memberships
      })
    };
  } catch (err) {
    console.error(`[workspaces-list] ${err.message}`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: null, workspaces: [], unavailable: true })
    };
  }
};
