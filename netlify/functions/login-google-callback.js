// Step 2 of "Sign in with Google": verify the signed state, exchange the
// code, read the user's VERIFIED email from Google's id_token, then either
// log in the existing account with that email or create a new one - and
// issue the exact same session cookie the password login issues, so every
// other function works unchanged. Google's sign-in tokens are used once to
// learn the email and never stored.
//
// Every failure branch logs its stage and the underlying reason to the
// function log (console.error -> Netlify's function logs) and redirects
// back to the login page with a stage-specific error code, so a broken
// flow can be diagnosed from either side. Secrets, codes, and tokens are
// never logged - only statuses, error names, and the redirect URI (which
// is public).
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
    console.error(`[login-google-callback] Google returned error=${qs.error}`);
    return backToLogin('google-cancelled');
  }
  if (!qs.code || !qs.state) {
    console.error(
      `[login-google-callback] missing params: code=${qs.code ? 'present' : 'MISSING'}, state=${qs.state ? 'present' : 'MISSING'}`
    );
    return backToLogin('google-failed');
  }

  let next = null;
  try {
    const state = jwt.verify(qs.state, process.env.SESSION_SECRET);
    if (state.purpose !== 'google-login') throw new Error('wrong purpose');
    next = state.next || null;
  } catch (err) {
    // forged, expired, or reused state - or a SESSION_SECRET mismatch
    console.error(`[login-google-callback] state verification failed: ${err.name}: ${err.message}`);
    return backToLogin('google-state-invalid');
  }

  try {
    const redirectUri = loginRedirectUri(event.headers);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: qs.code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.id_token) {
      // Google rejected the exchange - its error/error_description say why
      // (invalid_client = client id/secret pair wrong, invalid_grant = code
      // expired/reused, redirect_uri_mismatch = URI differs from the
      // authorize request or isn't registered).
      console.error(
        `[login-google-callback] token exchange failed: http=${tokenRes.status}, error=${tokenData.error || 'none'}, description=${tokenData.error_description || 'none'}, redirect_uri=${redirectUri}, client_id_set=${!!process.env.GOOGLE_CLIENT_ID}, client_secret_set=${!!process.env.GOOGLE_CLIENT_SECRET}`
      );
      return backToLogin('google-exchange-failed');
    }

    // The id_token arrived directly from Google's token endpoint over TLS
    // (not from the browser), so decoding without signature verification is
    // safe here - its authenticity is established by where we fetched it.
    const identity = jwt.decode(tokenData.id_token) || {};
    const email = (identity.email || '').toLowerCase();
    const emailVerified = identity.email_verified === true || identity.email_verified === 'true';

    // Matching accounts by email is only safe when Google vouches for it.
    if (!email || !emailVerified) {
      console.error(
        `[login-google-callback] identity rejected: email_present=${!!email}, email_verified=${identity.email_verified}`
      );
      return backToLogin('google-unverified');
    }

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
  } catch (err) {
    // Our side threw after Google succeeded or during the exchange call
    // itself (network, storage, dependency) - the stack pinpoints it.
    console.error(`[login-google-callback] server error: ${err.stack || err.message}`);
    return backToLogin('google-server-error');
  }
};
