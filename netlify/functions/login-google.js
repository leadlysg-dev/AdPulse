// Step 1 of "Sign in with Google". Unlike the ad-account connect flow
// (auth-google.js) there is no logged-in user yet, so the state parameter
// carries a short-lived signed token instead of an email - the callback
// rejects anything it didn't mint itself (CSRF protection). Only identity
// scopes are requested: no ads permissions, so the customer sees a plain
// "continue as you" consent, and reuses the same Google OAuth client as
// the ad-connect flow.
const jwt = require('jsonwebtoken');

const VALID_NEXT = ['connect-meta', 'connect-google'];

// The login callback URI is derived from the request host so no extra env
// var is needed - it must still be allowlisted on the Google OAuth client,
// so a spoofed host just fails at Google's door.
function loginRedirectUri(headers) {
  const proto = headers['x-forwarded-proto'] || 'https';
  return `${proto}://${headers.host}/.netlify/functions/login-google-callback`;
}

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const next = VALID_NEXT.includes(qs.next) ? qs.next : null;
  // An invite token riding in the state lets a brand-new person sign up
  // through Google: the callback claims the invite after Google verifies
  // the email. Without it, Google sign-in never mints accounts.
  const invite = qs.invite ? String(qs.invite).slice(0, 64) : null;

  const state = jwt.sign({ purpose: 'google-login', next, invite }, process.env.SESSION_SECRET, {
    expiresIn: '10m'
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: loginRedirectUri(event.headers),
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state
  });

  return {
    statusCode: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
    body: ''
  };
};

module.exports.loginRedirectUri = loginRedirectUri;
