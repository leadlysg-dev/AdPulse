// Step 2 of Meta connect flow: exchange the code for a token, fetch the list of
// ad accounts this customer manages, and save it against their account. If they
// manage more than one, they'll be sent to pick which one(s) to track.
const fetch = require('node-fetch');
const { getUser, saveUser, clearAiInsightCache } = require('./_store');

exports.handler = async (event) => {
  const { code, state: email } = event.queryStringParameters || {};
  if (!code || !email) return { statusCode: 400, body: 'Missing code or state from Facebook redirect.' };

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

  const longLivedParams = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: tokenData.access_token
  });
  const longLivedRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${longLivedParams.toString()}`);
  const longLivedData = await longLivedRes.json();
  const accessToken = longLivedData.access_token || tokenData.access_token;

  // Fetch every ad account this customer manages, so they can pick which one(s) matter.
  const acctRes = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name&access_token=${accessToken}`);
  const acctData = await acctRes.json();
  const adAccounts = (acctData.data || []).map((a) => ({ id: a.id, name: a.name }));

  const user = await getUser(email);
  if (!user) return { statusCode: 401, body: 'Session expired. Please log in again.' };

  user.accounts.meta = {
    accessToken,
    adAccounts,
    selectedAdAccountId: adAccounts.length === 1 ? adAccounts[0].id : null,
    connectedAt: new Date().toISOString()
  };
  await saveUser(user);
  await clearAiInsightCache(email).catch(() => {});

  const needsPicker = adAccounts.length > 1;
  return {
    statusCode: 302,
    headers: { Location: needsPicker ? '/select-account.html?provider=meta' : '/dashboard.html?connected=meta' },
    body: ''
  };
};
