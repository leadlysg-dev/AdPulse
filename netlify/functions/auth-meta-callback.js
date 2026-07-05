// Step 2 of Meta connect flow: Facebook sends the customer back here with a one-time
// code. We swap that code for a long-lived access token and store it against their
// session - this is the token our dashboard uses later to pull their ad data.
const fetch = require('node-fetch');
const { saveTokens } = require('./_store');

exports.handler = async (event) => {
  const { code, state } = event.queryStringParameters || {};
  if (!code || !state) {
    return { statusCode: 400, body: 'Missing code or state from Facebook redirect.' };
  }

  const tokenParams = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.META_REDIRECT_URI,
    code
  });

  const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${tokenParams.toString()}`);
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    return { statusCode: 400, body: 'Could not connect Meta account: ' + JSON.stringify(tokenData) };
  }

  // Exchange the short-lived token for a long-lived one (~60 days) so the customer
  // doesn't have to reconnect constantly.
  const longLivedParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: tokenData.access_token
  });
  const longLivedRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${longLivedParams.toString()}`);
  const longLivedData = await longLivedRes.json();

  await saveTokens(state, 'meta', {
    accessToken: longLivedData.access_token || tokenData.access_token,
    expiresIn: longLivedData.expires_in || tokenData.expires_in
  });

  return {
    statusCode: 302,
    headers: { Location: '/dashboard.html?connected=meta' },
    body: ''
  };
};
