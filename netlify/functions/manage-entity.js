// One validated, guardrailed, audited write: pause/enable, budget, or bid.
// POST { channel, entityType, entityId, action, value, acknowledged }.
const { getEmailFromRequest, getWorkspaceFromRequest, getDataUser, createChangeLog } = require('./_store');
const { executeWrite } = require('./_manage');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const VALID = {
  channel: ['meta', 'google'],
  entityType: ['campaign', 'adset', 'adgroup', 'ad'],
  action: ['set_status', 'set_budget', 'set_bid']
};

function validate(input) {
  if (!VALID.channel.includes(input.channel)) return 'Unknown channel.';
  if (!VALID.entityType.includes(input.entityType)) return 'Unknown entity type.';
  if (!VALID.action.includes(input.action)) return 'Unknown action.';
  if (typeof input.entityId !== 'string' || !/^[\w~-]{1,64}$/.test(input.entityId)) return 'Invalid entity id.';
  if (input.action === 'set_status') {
    if (!['active', 'paused'].includes(input.value)) return 'Status must be active or paused.';
  } else {
    const v = Number(input.value);
    if (!Number.isFinite(v) || v <= 0 || v > 1e7) return 'Value must be a positive amount.';
    input.value = v;
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request body.' });
  }
  const invalid = validate(input);
  if (invalid) return json(400, { error: invalid });

  // Writes act through the workspace owner's tokens for agency/admin
  // visitors; clients never reach here (their controls are locked, and the
  // role check below is the server-side guarantee).
  const workspace = await getWorkspaceFromRequest(event.headers, email);
  if (workspace.role === 'client' || workspace.role === 'member') {
    return json(403, { error: 'Your campaigns are managed by Leadly — ask Pulse to request a change.' });
  }
  const user = await getDataUser(email, workspace);
  if (!user) return json(401, { error: 'Not logged in.' });

  try {
    const result = await executeWrite(user, input);
    if (result.needsAck) return json(200, { needsAck: true, ...result });

    // The write happened - now record it. An audit failure never unwinds
    // the change, but it is loud and reported.
    let auditFailed = false;
    try {
      await createChangeLog(email, {
        channel: input.channel,
        accountId: user.accounts[input.channel].selectedAdAccountId,
        entityType: input.entityType,
        entityId: input.entityId,
        entityName: result.entityName,
        action: input.action,
        oldValue: result.oldValue,
        newValue: result.newValue,
        apiResult: result.apiResult
      });
    } catch (err) {
      auditFailed = true;
      console.error(`[manage-entity] AUDIT LOG FAILED (change WAS applied): ${err.message}`);
    }
    return json(200, { ok: true, ...result, auditFailed });
  } catch (err) {
    console.error(`[manage-entity] ${input.channel} ${input.action} ${input.entityId} failed: ${err.message}`);
    const status = err.forbidden ? 403 : err.readOnly ? 409 : 502;
    return json(status, { error: err.message, readOnly: !!err.readOnly });
  }
};
