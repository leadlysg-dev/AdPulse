// AES-256-GCM for platform API keys at rest. The data key is derived from
// SESSION_SECRET, so the ciphertext in Postgres is useless without the
// function environment. Format: v1:<iv b64>:<tag b64>:<ciphertext b64>.
const crypto = require('crypto');

function dataKey() {
  if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be set.');
  return crypto.scryptSync(process.env.SESSION_SECRET, 'leadly-platform-keys', 32);
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(stored) {
  const [v, iv, tag, data] = String(stored).split(':');
  if (v !== 'v1') throw new Error('Unknown ciphertext version.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
