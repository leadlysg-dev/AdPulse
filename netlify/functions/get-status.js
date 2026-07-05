const { getOrCreateSessionId, getTokens } = require('./_store');

exports.handler = async (event) => {
  const { sid } = getOrCreateSessionId(event.headers);
  const tokens = await getTokens(sid);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      metaConnected: !!tokens.meta,
      googleConnected: !!tokens.google
    })
  };
};
