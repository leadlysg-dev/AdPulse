// Shared helpers for calling Google APIs with the customer's stored OAuth
// tokens (the same access/refresh token pair saved by the existing Google
// connect flow - no separate auth system). Google access tokens expire
// after about an hour, so requests retry once through the refresh-token
// grant; callers persist the user when `tokenRefreshed` comes back true.
const fetch = require('node-fetch');

async function refreshGoogleToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  return data.access_token || null;
}

// Calls a Google API endpoint with the connection's token, refreshing it
// once on a 401. Mutates google.accessToken in place and reports it via
// tokenRefreshed so the caller can persist the fresh token.
async function googleApi(google, { url, method = 'GET', body, headers = {} }) {
  const attempt = (token) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });

  let tokenRefreshed = false;
  let res = await attempt(google.accessToken);
  if (res.status === 401 && google.refreshToken) {
    const fresh = await refreshGoogleToken(google.refreshToken);
    if (fresh) {
      google.accessToken = fresh;
      tokenRefreshed = true;
      res = await attempt(fresh);
    }
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, tokenRefreshed };
}

module.exports = { refreshGoogleToken, googleApi };
