import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useDemo } from '../demo/DemoContext';
import { DEMO_MESSAGE, DEMO_BLOCKED_EVENT } from '../demo/constants';

// The dashboard shell: 232px dark sidebar, sticky blurred topbar with
// connection chips, account footer. Tabs render inside.
const ShellContext = createContext(null);
export const useShell = () => useContext(ShellContext);

const ICONS = {
  pulse: (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
      <path d="M1 9h3l2-5 3 8 2-5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  admanager: (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
      <path d="M9 2.5L14 5v6l-5 2.5L4 11V5l5-2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2 6.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
};

const TABS = [
  { id: 'pulse', to: '/pulse.html', label: 'Pulse' },
  { id: 'admanager', to: '/campaigns.html', label: 'Campaigns' }
];

// Where each tab lives inside the demo - same components, /demo paths.
const DEMO_TO = {
  pulse: '/demo',
  admanager: '/demo/campaigns'
};

function NavItems({ pathname, mobile, demo }) {
  return TABS.map((t) => {
    const to = demo ? DEMO_TO[t.id] || t.to : t.to;
    return (
      <Link
        key={t.id}
        to={to}
        className={`nav-item${pathname === to ? ' active' : ''}`}
        role="tab"
        aria-selected={pathname === to}
      >
        {ICONS[t.id]}
        {t.label}
      </Link>
    );
  });
}

export default function Shell({ title, children }) {
  const { pathname } = useLocation();
  const isDemo = useDemo();

  const [status, setStatus] = useState(null);
  const [redirecting, setRedirecting] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getStatus()
      .then((s) => {
        if (cancelled) return;
        if (!s.loggedIn) {
          setRedirecting(true);
          window.location.href = '/login.html';
          return;
        }
        setStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(toastTimer.current);
    };
  }, []);

  // In demo the request adapter blocks every write and fires this event;
  // showing the toast here covers callers that swallow errors silently.
  useEffect(() => {
    if (!isDemo) return undefined;
    const onBlocked = () => toast(DEMO_MESSAGE);
    window.addEventListener(DEMO_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(DEMO_BLOCKED_EVENT, onBlocked);
  }, [isDemo, toast]);

  if (redirecting) return null;

  const email = status?.email || '';
  const initials = email
    .split('@')[0]
    .split(/[._-]/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '·';

  const ctx = {
    status,
    role: 'owner',
    toast
  };

  return (
    <ShellContext.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="logo">
            <div className="logo-mark">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 9h3l2-5 3 8 2-5h4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="logo-word">
              Leadly <span>Pulse</span>
            </div>
          </div>
          <nav className="nav" role="tablist" aria-label="Main navigation">
            <div className="nav-label">Workspace</div>
            <NavItems pathname={pathname} demo={isDemo} />
          </nav>
          <div className="sidebar-foot">
            <button
              type="button"
              className="acct"
              onClick={() =>
                // demo must never leave for the real settings page - a
                // logged-in visitor would land on their own account there
                isDemo ? toast(DEMO_MESSAGE) : (window.location.href = '/settings.html')
              }
              title={isDemo ? 'Sample workspace' : 'Account settings'}
            >
              <div className="avatar">{initials}</div>
              <div>
                <div className="acct-name">{email || '…'}</div>
                <div className="acct-plan">Internal</div>
              </div>
            </button>
            {!isDemo && (
              <button type="button" className="ws-item" onClick={() => (window.location.href = '/settings.html')}>
                Settings
              </button>
            )}
            {isDemo ? (
              <a className="ws-item" href="/login.html">
                Exit demo
              </a>
            ) : (
              <a className="ws-item" href="/.netlify/functions/logout">
                Log out
              </a>
            )}
          </div>
        </aside>

        <div className="main">
          {isDemo && (
            <div className="demo-banner" role="status">
              <span>You&rsquo;re viewing a demo with sample data</span>
              <a className="sbtn sbtn-sm demo-banner-cta" href="/login.html">
                Log in
              </a>
            </div>
          )}
          <header className="topbar">
            <span className="page-title">{title}</span>
            <div className="conn-dots">
              <span className="conn-chip">
                <span className={`dot ${status?.metaConnected ? 'meta' : 'off'}`} />
                Meta
              </span>
              <span className="conn-chip">
                <span className={`dot ${status?.googleConnected ? 'google' : 'off'}`} />
                Google Ads
              </span>
            </div>
            <div className="topbar-right" />
          </header>
          <main className="content">
            <div className="tab-pane">{children}</div>
          </main>
          <nav className="mobile-nav" aria-label="Main navigation">
            <NavItems pathname={pathname} mobile demo={isDemo} />
          </nav>
        </div>
      </div>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </ShellContext.Provider>
  );
}
