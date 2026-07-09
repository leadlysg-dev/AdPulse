// Step 1 of the Business Profile connect flow. Its own consent (separate
// from Google Ads) with the single business.manage scope. The redirect URI
// is derived from the request host and must be registered on the OAuth
// client: https://<host>/.netlify/functions/auth-gbp-callback
const { getEmailFromRequest } = require('./_store');
const { SCOPE } = require('./_gbp');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) {
    return { statusCode: 302, headers: { Location: '/login.html?next=connect-gbp' }, body: '' };
  }
  const host = event.headers.host;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `https://${host}/.netlify/functions/auth-gbp-callback`,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPE,
    state: email
  });
  return {
    statusCode: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
    body: ''
  };
};
