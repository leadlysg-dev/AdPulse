import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import './Login.css';

// Accepting a workspace invite is the only way to create an account -
// public signup is closed. The single-use token rides in the URL; this page
// collects the email + password and lands the new client on their dashboard.
export default function Invite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.inviteAccept(token, email, password);
      window.location.href = '/pulse.html';
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card card">
        <h1>You're invited to Leadly Pulse</h1>

        {!token && (
          <p className="login-error" role="alert">
            This invite link is missing its token — ask your agency contact to send it again.
          </p>
        )}

        {token && (
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
