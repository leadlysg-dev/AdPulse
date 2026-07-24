import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import './Login.css';

// Failure codes the Google sign-in callback can send us back with. Each
// maps to a distinct stage of the flow so failures are diagnosable.
const GOOGLE_ERRORS = {
  'google-cancelled': 'Google sign-in was cancelled.',
  'google-unverified': "Google couldn't verify that email address, so we can't sign you in with it.",
  'google-state-invalid': 'That sign-in attempt expired — please try again.',
  'google-exchange-failed':
    "Google didn't accept the sign-in. Please try again in a moment, or use your email and password.",
  'google-server-error':
    'Something went wrong on our side finishing the Google sign-in. Please try again, or use your email and password.',
  'google-failed': "Something went wrong signing in with Google. Please try again, or use your email and password.",
  'google-no-account':
    "There's no account for that Google email, and it isn't on the allowed list for this internal tool."
};

export default function Login() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => GOOGLE_ERRORS[params.get('error')] || '');
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState('login'); // 'login' | 'signup'

  const next = params.get('next');
  const googleHref = `/.netlify/functions/login-google${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'signup') await api.signup(email, password);
      else await api.login(email, password);

      const next = params.get('next');
      if (next === 'connect-meta') window.location.href = '/.netlify/functions/auth-meta';
      else if (next === 'connect-google') window.location.href = '/.netlify/functions/auth-google';
      else window.location.href = '/dashboard.html';
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-split">
        {/* The stage: the one dark object on the page. */}
        <section className="stage-dark tex-dark login-stage" aria-hidden="true">
          <div className="login-lockup">
            <span className="login-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="18" height="18">
                <path
                  d="M7 21 L13 13 L18 18 L25 8"
                  stroke="currentColor"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            Leadly <span className="login-product">Pulse</span>
          </div>
          <h2 className="display login-display">
            Internal reporting — <span className="accent">Meta + Google Ads.</span>
          </h2>
          <p className="login-lead">
            The agency's internal dashboard for client ad data, with AI that tells you what changed and why.
          </p>
        </section>

        <div className="login-card card">
          <h1>{mode === 'signup' ? 'Create the internal account' : 'Log in to Leadly Pulse'}</h1>

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

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </form>

        {error && <p className="login-error" role="alert">{error}</p>}

        <div className="login-divider" aria-hidden="true">
          <span>or</span>
        </div>

        <a className="btn btn-secondary btn-block google-signin" href={googleHref}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Sign in with Google
        </a>

        {/* Internal tool: account creation is limited to the emails in
            ALLOWED_LOGIN_EMAILS (set in the environment). */}
        <p className="login-toggle">
          {mode === 'signup' ? 'Already set up? ' : 'First time here? '}
          <button type="button" className="login-toggle-link" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); }}>
            {mode === 'signup' ? 'Log in instead' : 'Create the account'}
          </button>
        </p>

        <p className="login-toggle">
          Want a look around first? <a href="/demo">Explore the demo with sample data</a>.
        </p>
        </div>
      </div>
    </div>
  );
}
