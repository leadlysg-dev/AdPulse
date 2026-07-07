// Step 2 of Google connect flow: exchange the code for a refresh token, then list
// every Google Ads account this customer can access, so they can pick which one(s)
// to track - same pattern as the Meta callback.
const fetch = require('node-fetch');
const { getUser, saveUser } = require('./_store');
const { listScProperties } = require('./_google');
const { listAccessibleCustomers, gadsSearch } = require('./_googleAds');

exports.handler = async (event) => {
  const { code, state: email } = event.queryStringParameters || {};
  if (!code || !email) return { statusCode: 400, body: 'Missing code or state from Google redirect.' };

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

  // List every Google Ads account this customer can access, then fetch each
  // account's real name (best-effort - an unnamed entry still works). The
  // failure is logged, not swallowed: a sunset API version or unapproved
  // developer token used to fail here invisibly, leaving nothing to pick.
  const googleConn = { accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token };
  let adAccounts = [];
  try {
    const { ids } = await listAccessibleCustomers(googleConn);
    adAccounts = await Promise.all(
      ids.slice(0, 25).map(async (id) => {
        try {
          const { results } = await gadsSearch(
            googleConn,
            id,
            'SELECT customer.descriptive_name, customer.manager FROM customer LIMIT 1'
          );
          const c = (results[0] && results[0].customer) || {};
          return {
            id,
            name: c.descriptiveName || `Google Ads account ${id}`,
            manager: !!c.manager
          };
        } catch {
          return { id, name: `Google Ads account ${id}` };
        }
      })
    );
  } catch (err) {
    console.error(`[auth-google-callback] could not list Google Ads accounts: ${err.message}`);
    adAccounts = [];
  }

  // Same token also covers Search Console (webmasters.readonly is part of
  // the consent) - list the customer's properties for the SEO tab's picker.
  let scProperties = [];
  try {
    const sc = await listScProperties({ accessToken: tokenData.access_token });
    scProperties = sc.properties || [];
  } catch {
    scProperties = [];
  }

  const user = await getUser(email);
  if (!user) return { statusCode: 401, body: 'Session expired. Please log in again.' };

  user.accounts.google = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    adAccounts,
    selectedAdAccountId: adAccounts.length === 1 ? adAccounts[0].id : null,
    scProperties,
    selectedScSiteUrl: scProperties.length === 1 ? scProperties[0].siteUrl : null,
    connectedAt: new Date().toISOString()
  };
  await saveUser(user);

  const needsPicker = adAccounts.length > 1;
  return {
    statusCode: 302,
    headers: { Location: needsPicker ? '/select-account.html?provider=google' : '/dashboard.html?connected=google' },
    body: ''
  };
};
