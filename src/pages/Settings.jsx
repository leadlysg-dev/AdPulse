import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import ErrorState from '../components/ErrorState';
import MetricsOnboarding from '../components/MetricsOnboarding';
import './Settings.css';

// NOTE: the AI-preferences UI was removed for now, but any defaults it ever
// saved (user.aiPrefs: { enabled, insights:{enabled,cadence,prompt},
// assistant:{enabled,instructions} }) stay stored server-side and keep
// feeding chat/alert behaviour unchanged. The save-ai-prefs function still
// exists for when the UI returns.

function ConnectionRow({ label, connected, connectHref, onDisconnect, disconnectNote }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      await onDisconnect();
      setConfirming(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connection-row">
      <div className="connection-main">
        <div className="connection-copy">
          <span className="connection-name">{label}</span>
          <span className={`connection-status${connected ? ' is-connected' : ''}`}>
            <span className="connection-dot" aria-hidden="true" />
            {connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        {connected ? (
          !confirming && (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
              Disconnect
            </button>
          )
        ) : (
          <a className="btn btn-secondary" href={connectHref}>
            Connect {label}
          </a>
        )}
      </div>

      {confirming && (
        <div className="connection-confirm">
          <p>{disconnectNote}</p>
          <div className="connection-confirm-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={disconnect}>
              {busy ? 'Disconnecting…' : `Disconnect ${label}`}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
          {error && <p className="settings-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);

  // Master metrics setup (the only metrics control in the app)
  const [metricsConfig, setMetricsConfig] = useState(null);
  const [metricsSetup, setMetricsSetup] = useState(false);
  const [metricsSaved, setMetricsSaved] = useState(false);
  useEffect(() => {
    api.metricsConfig().then((r) => setMetricsConfig(r.config)).catch(() => {});
  }, []);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const s = await api.getStatus();
      if (!s.loggedIn) {
        setRedirecting(true);
        window.location.href = '/login.html';
        return;
      }
      setStatus(s);
    } catch (err) {
      setStatusError(err.message);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (redirecting) return null;

  const hasPassword = !!status?.hasPassword;

  async function submitPassword(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSaved(false);
    if (newPassword !== confirmPassword) {
      setPasswordError("The two new passwords don't match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api.changePassword(hasPassword ? currentPassword : undefined, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSaved(true);
      if (!hasPassword) await loadStatus(); // now shows the "Change password" form
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="settings-page">

      <main className="settings-main">
        <div className="settings-head">
          <h1>Settings</h1>
        </div>

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}

        {status && (
          <>
            <section className="settings-section">
              <h2>Account</h2>
              <div className="card settings-card">
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <span className="settings-row-label">Email</span>
                    <span className="settings-row-value">{status.email}</span>
                  </div>
                  <a className="btn btn-secondary" href="/.netlify/functions/logout">
                    Log out
                  </a>
                </div>

                <div className="settings-divider" role="separator" />

                <form className="password-form" onSubmit={submitPassword}>
                  <h3>{hasPassword ? 'Change password' : 'Set password'}</h3>
                  {!hasPassword && (
                    <p className="settings-hint">
                      You signed in with Google, so there's no password yet. Set one to also log in with
                      email and password.
                    </p>
                  )}

                  {hasPassword && (
                    <>
                      <label htmlFor="current-password">Current password</label>
                      <input
                        id="current-password"
                        type="password"
                        required
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </>
                  )}

                  <label htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />

                  <label htmlFor="confirm-password">Confirm new password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />

                  <div className="settings-actions">
                    <button type="submit" className="btn btn-primary" disabled={passwordBusy}>
                      {passwordBusy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
                    </button>
                    {passwordSaved && <span className="settings-saved">Password saved</span>}
                  </div>
                  {passwordError && <p className="settings-error" role="alert">{passwordError}</p>}
                </form>
              </div>
            </section>

            <section className="settings-section">
              <h2>Connections</h2>
              <div className="card settings-card">
                <ConnectionRow
                  label="Meta Ads"
                  connected={status.metaConnected}
                  connectHref="/.netlify/functions/auth-meta"
                  onDisconnect={async () => {
                    await api.disconnectProvider('meta');
                    await loadStatus();
                  }}
                  disconnectNote="Disconnecting Meta removes its stored access and your selected ad account. Your Pulse account, metrics setup, and other settings stay. You can reconnect any time."
                />
                <div className="settings-divider" role="separator" />
                <ConnectionRow
                  label="Google Ads"
                  connected={status.googleConnected}
                  connectHref="/.netlify/functions/auth-google"
                  onDisconnect={async () => {
                    await api.disconnectProvider('google');
                    await loadStatus();
                  }}
                  disconnectNote="Disconnecting Google removes its stored access and your selected ad account. You can reconnect any time."
                />
              </div>
            </section>

            <section className="settings-section">
              <h2>Metrics</h2>
              <div className="card settings-card">
                <div className="settings-row">
                  <div className="settings-row-copy">
                    <span className="settings-row-label">What Pulse tracks</span>
                    <span className="settings-hint">
                      {metricsConfig
                        ? `Your headline result is “${metricsConfig.primaryResult?.name || 'Enquiries'}”. Re-run the setup to change the metrics and results shown across Pulse and Campaigns.`
                        : 'Run the setup to choose the metrics and results shown across Pulse and Campaigns.'}
                    </span>
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={() => setMetricsSetup(true)}>
                    {metricsConfig ? 'Re-run metrics setup' : 'Run metrics setup'}
                  </button>
                </div>
                {metricsSaved && <p className="settings-saved">Metrics saved — every tab now follows them.</p>}
              </div>
            </section>

            {(status.metaConnected || status.googleConnected) && (
              <section className="settings-section">
                <h2>Data</h2>
                <div className="card settings-card">
                  {status.metaConnected && (
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">Meta ad account</span>
                        <span className="settings-hint">
                          {status.metaAccountName
                            ? `Which ad account Pulse reports on — currently ${status.metaAccountName}.`
                            : 'Not selected — choose an account.'}
                        </span>
                      </div>
                      <Link className="btn btn-secondary" to="/select-account.html?provider=meta">
                        {status.metaAccountName ? 'Change' : 'Choose'}
                      </Link>
                    </div>
                  )}
                  {status.metaConnected && status.googleConnected && <div className="settings-divider" role="separator" />}
                  {status.googleConnected && (
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">Google ad account</span>
                        <span className="settings-hint">
                          {status.googleAccountName
                            ? `Which ad account Pulse reports on — currently ${status.googleAccountName}.`
                            : 'Not selected — choose an account.'}
                        </span>
                      </div>
                      <Link className="btn btn-secondary" to="/select-account.html?provider=google">
                        {status.googleAccountName ? 'Change' : 'Choose'}
                      </Link>
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {metricsSetup && (
          <MetricsOnboarding
            initial={metricsConfig}
            onClose={() => setMetricsSetup(false)}
            onSaved={(saved) => {
              setMetricsConfig(saved);
              setMetricsSetup(false);
              setMetricsSaved(true);
            }}
          />
        )}
      </main>
    </div>
  );
}
