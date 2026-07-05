// Step 1 of Meta connect flow: sends the customer to Facebook's own login/consent screen.
// The customer never gives us a password or API key - Facebook handles that part.
const { getOrCreateSessionId, sessionCookie } = require('./_store');

exports.handler = async (event) => {
  const { sid, isNew } = getOrCreateSessionId(event.headers);

  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    state: sid,
    scope: 'ads_read,business_management',
    response_type: 'code'
  });

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;

  const headers = { Location: authUrl };
  if (isNew) headers['Set-Cookie'] = sessionCookie(sid);

  return { statusCode: 302, headers, body: '' };
};
