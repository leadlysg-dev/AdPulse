// Poll one edit chain: settle the pending step if its renders finished,
// then return the chain.
const { getEmailFromRequest, getStudioRecord, putStudioRecord } = require('./_store');
const { advanceChain, json } = require('./_studio');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  const id = (event.queryStringParameters || {}).id || '';
  try {
    const chain = await getStudioRecord(email, 'chain', id);
    if (!chain) return json(200, { error: 'No such chain.' });
    if (chain.pending) {
      await advanceChain(chain);
      await putStudioRecord(email, 'chain', chain.id, chain);
    }
    return json(200, { chain });
  } catch (err) {
    console.error(`[studio-chain] ${err.message}`);
    return json(200, { error: err.message });
  }
};
