// Step 2 of Google connect flow: swap the one-time code for a refresh token we can
// reuse indefinitely to pull the customer's Google Ads data without them logging in again.
const fetch = require('node-fetch');
const { saveTokens } = require('./_store');

exports.handler = async (event) => {
  const { code, state } = event.queryStringParameters || {};
  if (!code || !state) {
    return { statusCode: 400, body: 'Missing code or state from Google redirect.' };
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });
  const tokenData = await tokenRes.json();

  if (!tokenData.access_token) {
    return { statusCode: 400, body: 'Could not connect Google account: ' + JSON.stringify(tokenData) };
  }

  await saveTokens(state, 'google', {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresIn: tokenData.expires_in
  });

  return {
    statusCode: 302,
    headers: { Location: '/dashboard.html?connected=google' },
    body: ''
  };
};
