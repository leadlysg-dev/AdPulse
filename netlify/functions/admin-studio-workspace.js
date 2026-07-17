// Per-workspace Studio controls, admin only: monthly credit budget and the
// unlock flag. Until enabled, the tab keeps its coming-soon lock.
const { requireAdmin, json } = require('./_admin');
const { setWorkspaceStudio, getWorkspaceStudio, getMonthSpend, writeAudit } = require('./_store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const gate = await requireAdmin(event);
  if (gate.response) return gate.response;
  try {
    const body = JSON.parse(event.body || '{}');
    const workspaceId = String(body.workspaceId || '');
    if (!workspaceId) return json(400, { error: 'Which workspace?' });
    const patch = {};
    if (body.enabled !== undefined) patch.enabled = !!body.enabled;
    if (body.budget !== undefined) {
      const b = Number(body.budget);
      if (!isFinite(b) || b < 0) return json(400, { error: 'The budget must be a number of dollars.' });
      patch.budget = +b.toFixed(2);
    }
    await setWorkspaceStudio(workspaceId, patch);
    await writeAudit(gate.email, 'studio_workspace_updated', workspaceId, patch);
    const studio = await getWorkspaceStudio(workspaceId);
    const monthSpend = await getMonthSpend(workspaceId).catch(() => 0);
    return json(200, { ok: true, studio: { ...studio, monthSpend } });
  } catch (err) {
    console.error(`[admin-studio-workspace] ${err.message}`);
    return json(400, { error: err.message });
  }
};
