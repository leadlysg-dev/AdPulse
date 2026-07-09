// Step 2 of the Business Profile connect flow: exchange the code, list the
// user's locations, store as provider 'gbp'. GBP API access is approval-
// gated (zero default quota), so a denied listing is stored as a pending
// state, never treated as "no locations".
const fetch = require('node-fetch');
const { getUser, saveUser, clearAiInsightCache } = require('./_store');
const { listGbpLocations } = require('./_gbp');

exports.handler = async (event) => {
  const { code, state: email } = event.queryStringParameters || {};
  if (!code || !email) return { statusCode: 400, body: 'Missing code or state from Google redirect.' };

  const host = event.headers.host;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `https://${host}/.netlify/functions/auth-gbp-callback`,
      grant_type: 'authorization_code'
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.error(`[auth-gbp-callback] token exchange failed: ${JSON.stringify(tokenData)}`);
    return { statusCode: 400, body: 'Could not connect Business Profile: ' + JSON.stringify(tokenData) };
  }
  console.log(`[auth-gbp-callback] scopes granted: ${tokenData.scope || '(none)'} | refresh_token: ${tokenData.refresh_token ? 'yes' : 'NO'}`);

  const user = await getUser(email);
  if (!user) return { statusCode: 401, body: 'Session expired. Please log in again.' };

  const conn = { accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token };
  let adAccounts = [];
  try {
    const listed = await listGbpLocations(conn);
    if (listed.state === 'ok') {
      adAccounts = listed.locations;
      console.log(`[auth-gbp-callback] locations: ${adAccounts.map((l) => l.name).join(', ') || '(none)'}`);
    } else {
      console.error(`[auth-gbp-callback] location listing ${listed.state}: ${listed.detail}`);
    }
  } catch (err) {
    console.error(`[auth-gbp-callback] location listing failed: ${err.message}`);
  }

  const previous = user.accounts.gbp || {};
  user.accounts.gbp = {
    accessToken: conn.accessToken,
    refreshToken: tokenData.refresh_token || previous.refreshToken,
    adAccounts,
    selectedAdAccountId: adAccounts.length === 1 ? adAccounts[0].id : null,
    connectedAt: new Date().toISOString()
  };
  try {
    await saveUser(user);
    await clearAiInsightCache(email).catch(() => {});
  } catch (err) {
    console.error(`[auth-gbp-callback] saving the connection failed: ${err.message}`);
    return { statusCode: 500, body: 'Google authorized the connection but saving it failed - check the function logs.' };
  }
  return { statusCode: 302, headers: { Location: '/seo.html?connected=gbp' }, body: '' };
};
