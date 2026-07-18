// Bulk writes: the same validated single-entity path, run sequentially so
// rate limits stay comfortable, with a per-entity result list. POST
// { channel, entityType, action, value|percent, entities: [{id, name}],
//   acknowledged }.
const { getEmailFromRequest, getWorkspaceFromRequest, getDataUser, createChangeLog } = require('./_store');
const { executeWrite } = require('./_manage');
const { demoGuard } = require('./_demoGuard');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const MAX_BULK = 25;

exports.handler = async (event) => {
  const demoBlocked = demoGuard(event);
  if (demoBlocked) return demoBlocked;
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request body.' });
  }
  const entities = Array.isArray(input.entities) ? input.entities.slice(0, MAX_BULK) : [];
  if (!entities.length) return json(400, { error: 'Nothing selected.' });

  // Writes act through the workspace owner's tokens for agency/admin
  // visitors; clients never reach here (their controls are locked, and the
  // role check below is the server-side guarantee).
  const workspace = await getWorkspaceFromRequest(event.headers, email);
  if (workspace.role === 'client' || workspace.role === 'member') {
    return json(403, { error: 'Your campaigns are managed by Leadly — ask Pulse to request a change.' });
  }
  const user = await getDataUser(email, workspace);
  if (!user) return json(401, { error: 'Not logged in.' });

  const results = [];
  for (const entity of entities) {
    // Budget bulk supports "set to X" (value) or "change by %" (percent,
    // applied to each entity's own current budget server-side via a fresh
    // read inside executeWrite - percent is resolved per entity below).
    const single = {
      channel: input.channel,
      entityType: input.entityType,
      entityId: String(entity.id),
      action: input.action,
      value: input.value,
      acknowledged: !!input.acknowledged,
      percent: input.percent
    };
    try {
      if (input.action === 'set_budget' && input.percent != null) {
        // Resolve the per-entity amount from its own current budget - a
        // read-only probe, guaranteed never to write.
        const probe = await executeWrite(user, { ...single, value: 1, probe: true });
        if (!Number.isFinite(probe.currentBudget) || probe.currentBudget <= 0) {
          throw new Error('No current budget to adjust by percent.');
        }
        single.value = +(probe.currentBudget * (1 + Number(input.percent) / 100)).toFixed(2);
      }
      const result = await executeWrite(user, single);
      if (result.needsAck) {
        results.push({ id: entity.id, needsAck: true, reason: result.reason, oldValue: result.oldValue, newValue: result.newValue });
        continue;
      }
      try {
        await createChangeLog(email, {
          channel: input.channel,
          accountId: user.accounts[input.channel].selectedAdAccountId,
          entityType: input.entityType,
          entityId: String(entity.id),
          entityName: result.entityName,
          action: input.action,
          oldValue: result.oldValue,
          newValue: result.newValue,
          apiResult: result.apiResult
        });
      } catch (err) {
        console.error(`[manage-bulk] AUDIT LOG FAILED (change WAS applied): ${err.message}`);
      }
      results.push({ id: entity.id, ok: true, entityName: result.entityName, oldValue: result.oldValue, newValue: result.newValue });
    } catch (err) {
      results.push({ id: entity.id, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 250)); // gentle pacing
  }
  return json(200, { results });
};
