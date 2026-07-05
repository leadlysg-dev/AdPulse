// Password hashing, shared by both storage backends. scrypt is built into
// Node - no extra dependency needed for safe password hashing. The stored
// format is "salt:hash", identical in Blobs and Postgres, so hashes survive
// a storage migration unchanged.
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(check));
}

module.exports = { hashPassword, verifyPassword };
