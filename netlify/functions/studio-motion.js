// Poll one animate run until the clip is ready (it lands in the Library).
const { getEmailFromRequest, getStudioRecord, putStudioRecord } = require('./_store');
const { advanceMotion, json } = require('./_studio');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  const id = (event.queryStringParameters || {}).id || '';
  try {
    const rec = await getStudioRecord(email, 'motion', id);
    if (!rec) return json(200, { error: 'No such run.' });
    if (rec.state === 'generating') {
      await advanceMotion(rec);
      await putStudioRecord(email, 'motion', rec.id, rec);
    }
    return json(200, { motion: rec });
  } catch (err) {
    console.error(`[studio-motion] ${err.message}`);
    return json(200, { error: err.message });
  }
};
