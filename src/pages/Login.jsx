import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import './Login.css';

export default function Login() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === 'login';

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
