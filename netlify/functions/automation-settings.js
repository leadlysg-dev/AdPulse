// Automation module toggles (Messaging / Email / Win-Back / GMB), persisted
// per user. The Automations tab is locked (coming soon) but the settings
// survive here so switching the tab on later loses nothing.
const { getEmailFromRequest, getStudioRecord, putStudioRecord } = require('./_store');
const { demoGuard } = require('./_demoGuard');

const MODULES = ['messaging', 'email', 'winback', 'gmb'];
const DEFAULTS = { messaging: true, email: true, winback: true, gmb: true };

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const demoBlocked = demoGuard(event);
  if (demoBlocked) return demoBlocked;
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  try {
    if (event.httpMethod === 'GET') {
      const rec = await getStudioRecord(email, 'automations', 'settings');
      return json(200, { modules: { ...DEFAULTS, ...(rec ? rec.modules : {}) } });
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
    const body = JSON.parse(event.body || '{}');
    if (!MODULES.includes(body.module)) return json(400, { error: 'Unknown module.' });
    const rec = (await getStudioRecord(email, 'automations', 'settings')) || { modules: { ...DEFAULTS } };
    rec.modules = { ...DEFAULTS, ...rec.modules, [body.module]: !!body.enabled };
    rec.updated = Date.now();
    await putStudioRecord(email, 'automations', 'settings', rec);
    return json(200, { ok: true, modules: rec.modules });
  } catch (err) {
    console.error(`[automation-settings] ${err.message}`);
    return json(400, { error: err.message });
  }
};
