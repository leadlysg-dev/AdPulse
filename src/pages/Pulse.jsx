import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import TopNav from '../components/TopNav';
import AiInsights from '../components/AiInsights';
import ChatPanel from '../components/ChatPanel';
import AlertPresets from '../components/AlertPresets';
import AlertsPanel from '../components/AlertsPanel';
import DateRangePicker from '../components/DateRangePicker';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import './Pulse.css';

// Pulse: the front tab - AI insights and the alerts assistant in one place.
// Both features work exactly as they did on their previous pages; this is a
// layout merge.
export default function Pulse() {
  const [params] = useSearchParams();
  const justConnected = params.get('connected');

  const [range, setRange] = useState('last_7d');
  const [alertsVersion, setAlertsVersion] = useState(0);

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const s = await api.getStatus();
      if (!s.loggedIn) {
        setRedirecting(true);
        window.location.href = '/login.html';
        return;
      }
      if (s.metaNeedsPick) {
        setRedirecting(true);
        window.location.href = '/select-account.html?provider=meta';
        return;
      }
      if (s.googleNeedsPick) {
        setRedirecting(true);
        window.location.href = '/select-account.html?provider=google';
        return;
      }
      if (s.metaNeedsMetrics) {
        setRedirecting(true);
        window.location.href = '/select-metrics.html?provider=meta';
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

  // Mirror of the server's gates: master + per-feature toggles; never-saved
  // preferences default to on.
  const prefs = status?.aiPrefs;
  const aiOff = !!prefs && !prefs.enabled;
  const assistantOff = !!prefs && (!prefs.enabled || !prefs.assistant?.enabled);

  return (
    <div className="pulse-page">
      <TopNav email={status?.email} />

      <main className="pulse-main">
        <div className="pulse-head">
          <h1>PulseAI</h1>
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        {justConnected && (
          <Banner tone="success">
            {justConnected === 'meta' ? 'Meta' : 'Google'} account connected. Numbers may take a minute to reflect it.
          </Banner>
        )}

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}

        {status && !status.metaConnected && (
          <Banner tone="info">
            Connect your ad account in <Link to="/settings.html">Settings</Link> to see live insights.
          </Banner>
        )}

        {status && aiOff ? (
          <div className="card pulse-off">
            <p>AI features are off.</p>
            <p className="pulse-off-sub">
              Turn them on in <Link to="/settings.html">Settings</Link> to get insights and set up alerts in
              plain English.
            </p>
          </div>
        ) : (
          <>
            <AiInsights range={range} />

            {status && assistantOff ? (
              <div className="card pulse-off">
                <p>The assistant is off.</p>
                <p className="pulse-off-sub">
                  Turn on the assistant in <Link to="/settings.html">Settings</Link> to set up alerts in plain
                  English.
                </p>
              </div>
            ) : (
              <>
                <AlertPresets
                  metaMetric={status?.metaPrimaryMetric}
                  googleMetric={status?.googlePrimaryMetric}
                  onRulesCreated={() => setAlertsVersion((v) => v + 1)}
                />
                <div className="pulse-layout">
                  <ChatPanel onRulesCreated={() => setAlertsVersion((v) => v + 1)} />
                  <AlertsPanel reloadToken={alertsVersion} />
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
