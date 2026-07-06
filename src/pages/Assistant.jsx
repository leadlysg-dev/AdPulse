import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import TopNav from '../components/TopNav';
import ErrorState from '../components/ErrorState';
import './Assistant.css';

const SUGGESTIONS = [
  'Let me know when CPA falls below $10',
  'Tell me if Meta spend goes over $500 in a day',
  'Alert me when ROAS drops below 2x this week'
];

const GREETING =
  "Hi! I can set up performance alerts for you in plain English — CPA, ROAS, spend, CTR, or conversions on Meta, Google, or both. What would you like to watch?";

function AlertRow({ rule, onToggle, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <li className="alert-row">
      <div className="alert-row-main">
        <div className="alert-row-copy">
          <span className={`alert-row-desc${rule.enabled ? '' : ' is-off'}`}>{rule.description}</span>
          <span className="alert-row-sub">{rule.enabled ? 'On' : 'Off'}</span>
        </div>
        <div className="alert-row-actions">
          <button
            type="button"
            role="switch"
            aria-checked={rule.enabled}
            aria-label={`Alert: ${rule.description}`}
            className={`toggle${rule.enabled ? ' toggle-on' : ''}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onToggle(rule, !rule.enabled);
              } finally {
                setBusy(false);
              }
            }}
          >
            <span className="toggle-knob" />
          </button>
          <button
            type="button"
            className="alert-row-delete"
            aria-label={`Delete alert: ${rule.description}`}
            disabled={busy}
            onClick={() => setConfirming((c) => !c)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      {confirming && (
        <div className="alert-row-confirm">
          <span>Delete this alert?</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete(rule);
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

export default function Assistant() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  // The greeting is client-side only (flagged so it's never sent to the
  // API, whose history must start with a user turn).
  const [messages, setMessages] = useState([{ role: 'assistant', content: GREETING, greeting: true }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const [rules, setRules] = useState(null);
  const [rulesError, setRulesError] = useState(null);

  const scrollRef = useRef(null);

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

  const loadRules = useCallback(async () => {
    setRulesError(null);
    try {
      const result = await api.listAlerts();
      setRules(result.rules);
    } catch (err) {
      setRulesError(err.message);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadRules();
  }, [loadStatus, loadRules]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  if (redirecting) return null;

  // Settings gate, mirroring the server's: master toggle AND assistant
  // toggle; never-saved preferences default to on.
  const prefs = status?.aiPrefs;
  const assistantOff = !!prefs && (!prefs.enabled || !prefs.assistant?.enabled);

  async function send(text) {
    const content = text.trim();
    if (!content || sending) return;
    const history = [...messages.filter((m) => !m.greeting), { role: 'user', content }];
    setMessages((m) => [...m, { role: 'user', content }]);
    setInput('');
    setSending(true);
    try {
      // The greeting is client-side only; send just real turns.
      const result = await api.assistantChat(
        history.slice(-12).map(({ role, content: c }) => ({ role, content: c }))
      );
      if (result.enabled === false) {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: 'AI features are turned off in your Settings, so I can’t help right now.' }
        ]);
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: result.reply }]);
        if (result.rules?.length) await loadRules();
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: 'Something went wrong sending that — please try again.' }
      ]);
    } finally {
      setSending(false);
    }
  }

  async function toggleRule(rule, enabled) {
    await api.updateAlert(rule.id, enabled);
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
  }

  async function deleteRule(rule) {
    await api.deleteAlert(rule.id);
    setRules((rs) => rs.filter((r) => r.id !== rule.id));
  }

  const showSuggestions = messages.filter((m) => m.role === 'user').length === 0;

  return (
    <div className="assistant-page">
      <TopNav email={status?.email} />

      <main className="assistant-main">
        <div className="assistant-head">
          <h1>Assistant</h1>
        </div>

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}

        {status && assistantOff ? (
          <div className="card assistant-off">
            <p>The assistant is off.</p>
            <p className="assistant-off-sub">
              Turn on AI features and the assistant in <Link to="/settings.html">Settings</Link> to set up
              alerts in plain English.
            </p>
          </div>
        ) : (
          <div className="assistant-layout">
            <section className="card chat-panel" aria-label="Assistant chat">
              <div className="chat-messages" ref={scrollRef}>
                {messages.map((m, i) => (
                  <div key={i} className={`chat-bubble chat-${m.role}`}>
                    {m.content}
                  </div>
                ))}
                {sending && (
                  <div className="chat-bubble chat-assistant chat-typing" aria-label="Assistant is typing">
                    <span /><span /><span />
                  </div>
                )}
              </div>

              {showSuggestions && (
                <div className="chat-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="chat-suggestion" onClick={() => send(s)} disabled={sending}>
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <form
                className="chat-input-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
              >
                <label className="visually-hidden" htmlFor="chat-input">Message the assistant</label>
                <input
                  id="chat-input"
                  type="text"
                  placeholder="e.g. Alert me when CPA goes above $20"
                  autoComplete="off"
                  maxLength={500}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
                  Send
                </button>
              </form>
            </section>

            <section className="alerts-panel" aria-label="My alerts">
              <h2>My Alerts</h2>
              <p className="alerts-panel-note">
                Alert delivery is coming soon — rules you save here are ready and will go live when it ships.
              </p>

              {rulesError && <ErrorState message={rulesError} onRetry={loadRules} />}

              {!rulesError && rules && rules.length === 0 && (
                <div className="card alerts-empty">
                  <p>No alerts yet.</p>
                  <p className="alerts-empty-sub">Ask the assistant to watch a number for you.</p>
                </div>
              )}

              {!rulesError && rules && rules.length > 0 && (
                <ul className="card alerts-list">
                  {rules.map((rule) => (
                    <AlertRow key={rule.id} rule={rule} onToggle={toggleRule} onDelete={deleteRule} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
