// The All-workspaces directory: every workspace with owner, connection
// health, member count, last activity, and Managed-mode state. Admin only.
const { requireAdmin, json } = require('./_admin');
const { listAllWorkspaces, getMonthSpendAll } = require('./_store');

exports.handler = async (event) => {
  const gate = await requireAdmin(event);
  if (gate.response) return gate.response;
  try {
    const workspaces = await listAllWorkspaces();
    const spend = await getMonthSpendAll().catch(() => ({}));
    workspaces.forEach((w) => {
      w.studioMonthSpend = spend[w.id] || 0;
    });
    return json(200, { workspaces });
  } catch (err) {
    console.error(`[admin-workspaces] ${err.message}`);
    return json(400, { error: err.message });
  }
};
