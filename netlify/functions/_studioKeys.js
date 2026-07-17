// Platform API keys for Studio: encrypted rows in platform_settings,
// decrypted only here, with environment variables as fallback. Keys are
// used exclusively by server routes proxying fal and Anthropic - nothing
// here is ever returned to the browser except set/last4 metadata.
const { decrypt } = require('./_crypto');

const KEY_NAMES = ['FAL_KEY', 'FAL_ADMIN_KEY', 'ANTHROPIC_API_KEY'];

async function loadStudioKeys(store) {
  const out = {};
  for (const name of KEY_NAMES) {
    let v = null;
    try {
      const stored = await store.getPlatformSetting(name);
      if (stored) v = decrypt(stored);
    } catch (err) {
      console.error(`[studio-keys] could not read ${name}: ${err.message}`);
    }
    out[name] = v || process.env[name] || null;
  }
  return { fal: out.FAL_KEY, falAdmin: out.FAL_ADMIN_KEY, anthropic: out.ANTHROPIC_API_KEY, raw: out };
}

module.exports = { loadStudioKeys, KEY_NAMES };
