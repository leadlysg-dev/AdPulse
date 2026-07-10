import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import TopNav from '../components/TopNav';
import ErrorState from '../components/ErrorState';
import './Settings.css';

// AI features are on by default - for new customers and for existing ones
// who never saved preferences (the server treats never-saved the same way).
// Only an explicitly saved "off" turns them off.
const DEFAULT_AI_PREFS = {
  enabled: true,
  insights: { enabled: true, cadence: 'weekly', prompt: '' },
  assistant: { enabled: true, instructions: '' }
};

function Toggle({ label, checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle${checked ? ' toggle-on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

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

  // AI preferences form
  const [prefs, setPrefs] = useState(null);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const [prefsSaved, setPrefsSaved] = useState(false);

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
      // Only seed the form on first load so a background refresh (e.g. after
      // a disconnect) can't wipe unsaved edits.
      setPrefs((p) => p || { ...DEFAULT_AI_PREFS, ...(s.aiPrefs || {}) });
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

  function setPref(updater) {
    setPrefsSaved(false);
    setPrefs((p) => updater(p));
  }

  async function savePrefs() {
    setPrefsError('');
    setPrefsSaved(false);
    setPrefsBusy(true);
    try {
      const saved = await api.saveAiPrefs(prefs);
      setPrefs(saved.aiPrefs);
      setPrefsSaved(true);
    } catch (err) {
      setPrefsError(err.message);
    } finally {
      setPrefsBusy(false);
    }
  }

  const aiOff = !prefs?.enabled;

  return (
    <div className="settings-page">
      <TopNav email={status?.email} />

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
                  disconnectNote="Disconnecting Meta removes its stored access, your selected ad account, and your tracked metrics and goals. Your Pulse account and history of other settings stay. You can reconnect any time."
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

            {status.metaConnected && (
              <section className="settings-section">
                <h2>Data</h2>
                <div className="card settings-card">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">Meta ad account</span>
                      <span className="settings-hint">Which ad account Pulse reports on.</span>
                    </div>
                    <Link className="btn btn-secondary" to="/select-account.html?provider=meta">
                      Change
                    </Link>
                  </div>
                  {status.googleConnected && (
                    <>
                      <div className="settings-divider" role="separator" />
                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <span className="settings-row-label">Search Console property</span>
                          <span className="settings-hint">
                            {status.scSiteUrl || 'Not selected yet — pick one on the SEO tab.'}
                          </span>
                        </div>
                        <Link className="btn btn-secondary" to="/seo.html">
                          {status.scSiteUrl ? 'View' : 'Choose'}
                        </Link>
                      </div>
                    </>
                  )}
                  <div className="settings-divider" role="separator" />
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">Meta tracked metrics</span>
                      <span className="settings-hint">The Meta conversions shown across Reporting and Pulse.</span>
                    </div>
                    <Link className="btn btn-secondary" to="/select-metrics.html?provider=meta">
                      Edit
                    </Link>
                  </div>
                  {status.googleConnected && (
                    <>
                      <div className="settings-divider" role="separator" />
                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <span className="settings-row-label">Google tracked metrics</span>
                          <span className="settings-hint">
                            {status.googleNeedsMetrics
                              ? 'Not chosen yet — pick which Google conversion actions to track.'
                              : 'The Google conversion actions shown on Reporting.'}
                          </span>
                        </div>
                        <Link className="btn btn-secondary" to="/select-metrics.html?provider=google">
                          {status.googleNeedsMetrics ? 'Choose' : 'Edit'}
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            <section className="settings-section">
              <h2>AI preferences</h2>
              <p className="settings-section-sub">
                These preferences save now; the AI features that use them are coming in a later update.
              </p>
              {prefs && (
                <div className="card settings-card">
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">AI features</span>
                      <span className="settings-hint">Master switch for everything below.</span>
                    </div>
                    <Toggle
                      label="AI features"
                      checked={prefs.enabled}
                      onChange={(v) => setPref((p) => ({ ...p, enabled: v }))}
                    />
                  </div>

                  <div className="settings-divider" role="separator" />

                  <div className={`ai-group${aiOff ? ' is-disabled' : ''}`}>
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">Daily / weekly insights</span>
                        <span className="settings-hint">A recurring summary of how your ads are doing.</span>
                      </div>
                      <Toggle
                        label="Daily or weekly insights"
                        checked={prefs.insights.enabled}
                        disabled={aiOff}
                        onChange={(v) => setPref((p) => ({ ...p, insights: { ...p.insights, enabled: v } }))}
                      />
                    </div>

                    <div className="ai-field">
                      <span className="settings-row-label" id="cadence-label">Frequency</span>
                      <div className="range-picker" role="group" aria-labelledby="cadence-label">
                        {['daily', 'weekly'].map((c) => (
                          <button
                            key={c}
                            type="button"
                            className={`range-picker-option${prefs.insights.cadence === c ? ' selected' : ''}`}
                            aria-pressed={prefs.insights.cadence === c}
                            disabled={aiOff || !prefs.insights.enabled}
                            onClick={() => setPref((p) => ({ ...p, insights: { ...p.insights, cadence: c } }))}
                          >
                            {c === 'daily' ? 'Daily' : 'Weekly'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="ai-field">
                      <label htmlFor="insights-prompt">What should the summaries focus on?</label>
                      <textarea
                        id="insights-prompt"
                        rows={3}
                        maxLength={2000}
                        placeholder="e.g. Focus on cost per lead and flag any ad whose results dropped versus last week."
                        disabled={aiOff || !prefs.insights.enabled}
                        value={prefs.insights.prompt}
                        onChange={(e) => setPref((p) => ({ ...p, insights: { ...p.insights, prompt: e.target.value } }))}
                      />
                    </div>

                    <div className="settings-divider" role="separator" />

                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">AI assistant &amp; alerts</span>
                        <span className="settings-hint">Ask questions and get notified when something needs attention.</span>
                      </div>
                      <Toggle
                        label="AI assistant and alerts"
                        checked={prefs.assistant.enabled}
                        disabled={aiOff}
                        onChange={(v) => setPref((p) => ({ ...p, assistant: { ...p.assistant, enabled: v } }))}
                      />
                    </div>

                    <div className="ai-field">
                      <label htmlFor="assistant-instructions">Default instructions</label>
                      <textarea
                        id="assistant-instructions"
                        rows={3}
                        maxLength={2000}
                        placeholder="e.g. Only alert me about changes bigger than 20%, and keep messages short."
                        disabled={aiOff || !prefs.assistant.enabled}
                        value={prefs.assistant.instructions}
                        onChange={(e) =>
                          setPref((p) => ({ ...p, assistant: { ...p.assistant, instructions: e.target.value } }))
                        }
                      />
                    </div>
                  </div>

                  <div className="settings-actions">
                    <button type="button" className="btn btn-primary" disabled={prefsBusy} onClick={savePrefs}>
                      {prefsBusy ? 'Saving…' : 'Save AI preferences'}
                    </button>
                    {prefsSaved && <span className="settings-saved">Saved</span>}
                  </div>
                  {prefsError && <p className="settings-error" role="alert">{prefsError}</p>}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
