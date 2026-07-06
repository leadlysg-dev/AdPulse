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
  'google-failed': "Something went wrong signing in with Google. Please try again, or use your email and password."
};

export default function Login() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => GOOGLE_ERRORS[params.get('error')] || '');
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === 'login';
  const next = params.get('next');
  const googleHref = `/.netlify/functions/login-google${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (isLogin) {
        await api.login(email, password);
      } else {
        await api.signup(email, password);
      }

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
      <div className="login-card card">
        <h1>{isLogin ? 'Log in to AdPulse' : 'Create your AdPulse account'}</h1>

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
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Please wait…' : isLogin ? 'Log in' : 'Create account'}
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

        <p className="login-toggle">
          {isLogin ? "New here? " : 'Already have an account? '}
          <button
            type="button"
            className="login-toggle-link"
            onClick={() => {
              setMode(isLogin ? 'signup' : 'login');
              setError('');
            }}
          >
            {isLogin ? 'Create an account' : 'Log in'}
          </button>
        </p>
      </div>
    </div>
  );
}
