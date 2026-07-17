// Platform-admin key vault: FAL_KEY, FAL_ADMIN_KEY, ANTHROPIC_API_KEY.
// Values are AES-encrypted at rest and never returned - GET exposes only
// set/last4, plus the live fal balance read with the admin key.
const { requireAdmin, json } = require('./_admin');
const store = require('./_store');
const { encrypt } = require('./_crypto');
const { loadStudioKeys, KEY_NAMES } = require('./_studioKeys');
const { falBalance } = require('./_studioCore');

const MOCK = () => process.env.STUDIO_MOCK === '1';

exports.handler = async (event) => {
  const gate = await requireAdmin(event);
  if (gate.response) return gate.response;
  try {
    if (event.httpMethod === 'GET') {
      const keys = await loadStudioKeys(store);
      const meta = {};
      for (const name of KEY_NAMES) {
        const v = keys.raw[name];
        meta[name] = v ? { set: true, last4: v.slice(-4) } : { set: false };
      }
      let balance = null;
      if (keys.falAdmin) {
        try {
          balance = MOCK() ? { usd: 42.0 } : await falBalance(keys.falAdmin);
        } catch (err) {
          balance = { error: err.message };
        }
      }
      return json(200, { keys: meta, balance });
    }
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
    const body = JSON.parse(event.body || '{}');
    const updates = body.keys || {};
    let saved = 0;
    for (const name of KEY_NAMES) {
      const v = updates[name];
      if (typeof v === 'string' && v.trim()) {
        await store.savePlatformSetting(name, encrypt(v.trim()));
        saved++;
      }
    }
    await store.writeAudit(gate.email, 'studio_keys_updated', null, { saved });
    return json(200, { ok: true, saved });
  } catch (err) {
    console.error(`[admin-studio-keys] ${err.message}`);
    return json(400, { error: err.message });
  }
};
