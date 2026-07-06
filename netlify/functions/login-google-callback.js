// Step 2 of "Sign in with Google": verify the signed state, exchange the
// code, read the user's VERIFIED email from Google's id_token, then either
// log in the existing account with that email or create a new one - and
// issue the exact same session cookie the password login issues, so every
// other function works unchanged. Google's sign-in tokens are used once to
// learn the email and never stored.
const crypto = require('crypto');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { getUser, createUser, createSessionCookie } = require('./_store');
const { loginRedirectUri } = require('./login-google');

// Friendly failures land back on the login page with a readable message
// (the login page maps these codes to text) instead of a raw error body.
function backToLogin(code) {
  return {
    statusCode: 302,
    headers: { Location: `/login.html?error=${code}` },
    body: ''
  };
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};

  if (qs.error) {
    // e.g. the customer clicked "Cancel" on Google's consent screen
    return backToLogin('google-cancelled');
  }
  if (!qs.code || !qs.state) return backToLogin('google-failed');

  let next = null;
  try {
    const state = jwt.verify(qs.state, process.env.SESSION_SECRET);
    if (state.purpose !== 'google-login') throw new Error('wrong purpose');
    next = state.next || null;
  } catch {
    return backToLogin('google-failed'); // forged, expired, or reused state
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: qs.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: loginRedirectUri(event.headers),
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.id_token) return backToLogin('google-failed');

    // The id_token arrived directly from Google's token endpoint over TLS
    // (not from the browser), so decoding without signature verification is
    // safe here - its authenticity is established by where we fetched it.
    const identity = jwt.decode(tokenData.id_token) || {};
    const email = (identity.email || '').toLowerCase();
    const emailVerified = identity.email_verified === true || identity.email_verified === 'true';

    // Matching accounts by email is only safe when Google vouches for it.
    if (!email || !emailVerified) return backToLogin('google-unverified');

    let user = await getUser(email);
    if (!user) {
      // A normal user row with an unguessable placeholder password - they
      // sign in with Google; email/password correctly rejects until they
      // set a real one from Settings (passwordSet: false is what makes
      // Settings offer "Set password" instead of "Change password").
      user = await createUser(email, crypto.randomBytes(32).toString('hex'), {
        passwordSet: false
      });
    }

    const destination =
      next === 'connect-meta'
        ? '/.netlify/functions/auth-meta'
        : next === 'connect-google'
          ? '/.netlify/functions/auth-google'
          : '/dashboard.html';

    return {
      statusCode: 302,
      headers: { Location: destination, 'Set-Cookie': createSessionCookie(user.email) },
      body: ''
    };
  } catch {
    return backToLogin('google-failed');
  }
};
