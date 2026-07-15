// The fal credit balance shown in the Studio header. fal only serves this
// to an admin-scoped key; without one the UI shows "unavailable" plus the
// hint, and everything else still works.
const { getEmailFromRequest } = require('./_store');
const { falBalance, json } = require('./_studio');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  return json(200, await falBalance());
};
