// Step 1 of Google connect flow: sends the customer to Google's own login/consent screen.
const { getOrCreateSessionId, sessionCookie } = require('./_store');

exports.handler = async (event) => {
  const { sid, isNew } = getOrCreateSessionId(event.headers);

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/adwords',
    state: sid
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const headers = { Location: authUrl };
  if (isNew) headers['Set-Cookie'] = sessionCookie(sid);

  return { statusCode: 302, headers, body: '' };
};
