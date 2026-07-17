import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import './Login.css';

// Accepting a workspace invite is the only way to create an account -
// public signup is closed. The single-use token rides in the URL; the page
// first checks the token (valid / used / expired), then lets the person
// sign up with email + password or with Google. The invite's role decides
// where they land: owners go to connect-accounts, everyone else to Pulse.
export default function Invite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const googleError = params.get('error') === 'google';

  const [info, setInfo] = useState(null); // { state, workspaceName, role }
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(googleError ? 'Google sign-up could not claim this invite — it may have been used or expired.' : '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .inviteInfo(token)
      .then((r) => !cancelled && setInfo(r))
      .catch(() => !cancelled && setInfo({ state: 'valid' })); // peek endpoint unavailable - let accept decide
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const r = await api.inviteAccept(token, email, password);
      window.location.href = r.role === 'owner' ? '/settings.html?welcome=1' : '/pulse.html';
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setSubmitting(false);
    }
  }

  const dead = info && (info.state === 'used' || info.state === 'expired' || info.state === 'invalid');
  const deadCopy = {
    used: 'This invite link has already been used — each link works exactly once. Ask your Leadly contact for a fresh one.',
    expired: 'This invite link has expired — links last seven days. Ask your Leadly contact for a fresh one.',
    invalid: 'This invite link is not valid. Check you copied the whole link, or ask your Leadly contact for a new one.'
  };

  return (
    <div className="login-page">
      <div className="login-card card">
        <h1>
          {info?.workspaceName ? `Join ${info.workspaceName} on Leadly Pulse` : "You're invited to Leadly Pulse"}
        </h1>

        {!token && (
          <p className="login-error" role="alert">
            This invite link is missing its token — ask your agency contact to send it again.
          </p>
        )}

        {token && dead && (
          <p className="login-error" role="alert">
            {deadCopy[info.state]}
          </p>
        )}

        {token && !dead && (
          <>
            {info?.role === 'owner' && (
              <p className="settings-hint" style={{ marginBottom: 12 }}>You'll be the owner of this workspace — after signing up you'll connect its ad accounts.</p>
            )}
            <form onSubmit={handleSubmit}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <label htmlFor="password">Choose a password</label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                {submitting ? 'Please wait…' : 'Create my account'}
              </button>
            </form>

            <div className="login-divider" aria-hidden="true">or</div>
            <a className="btn btn-secondary btn-block" href={`/.netlify/functions/login-google?invite=${encodeURIComponent(token)}`}>
              Sign up with Google
            </a>
          </>
        )}

        {error && <p className="login-error" role="alert">{error}</p>}

        <p className="login-toggle">
          Invite links are single-use. Already have an account? <a href="/login.html">Log in</a> first, then open
          this link again to join the workspace.
        </p>
      </div>
    </div>
  );
}
