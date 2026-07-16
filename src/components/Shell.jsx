import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';

// The five-tab dashboard shell from the v5 UI spec: 232px dark sidebar,
// sticky blurred topbar with connection chips + date range + share, account
// footer with the workspace switcher (owners only). Tabs render inside.
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
  ),
  studio: (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5l1.6 4L14 7l-4.4 1.5L8 12.5 6.4 8.5 2 7l4.4-1.5L8 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12.8 11l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6z" fill="currentColor" />
    </svg>
  ),
  crm: (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
      <circle cx="5.5" cy="5.5" r="2.3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 13c.5-2.4 2.1-3.6 4-3.6s3.5 1.2 4 3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="11.5" cy="5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 9.2c1.9 0 3.1 1 3.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  automations: (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
      <path d="M9 1.5L3 9h4l-1 5.5L12 7H8l1-5.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
};

const TABS = [
  { id: 'pulse', to: '/pulse.html', label: 'Pulse' },
  { id: 'admanager', to: '/admanager.html', label: 'Ad Manager' },
  { id: 'studio', to: '/studio.html', label: 'Studio', soon: true },
  { id: 'crm', to: '/crm.html', label: 'CRM', badge: '↗' },
  { id: 'automations', to: '/automations.html', label: 'Automations', soon: true }
];

function NavItems({ pathname, mobile }) {
  return TABS.map((t) => (
    <Link
      key={t.id}
      to={t.to}
      className={`nav-item${pathname === t.to ? ' active' : ''}`}
      role="tab"
      aria-selected={pathname === t.to}
    >
      {ICONS[t.id]}
      {mobile ? t.label : t.label}
      {t.soon && !mobile && <span className="nav-badge soon">SOON</span>}
      {t.badge && !mobile && <span className="nav-badge">{t.badge}</span>}
    </Link>
  ));
}

export default function Shell({ title, children }) {
  const { pathname } = useLocation();

  const [status, setStatus] = useState(null);
  const [redirecting, setRedirecting] = useState(false);
  const [ws, setWs] = useState(null); // { active, workspaces }
  const [wsOpen, setWsOpen] = useState(false);
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
    api
      .workspacesList()
      .then((w) => !cancelled && setWs(w))
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(toastTimer.current);
    };
  }, []);

  if (redirecting) return null;

  const email = status?.email || '';
  const initials = email
    .split('@')[0]
    .split(/[._-]/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '·';
  const role = ws?.active?.role || 'owner';
  const workspaces = ws?.workspaces || [];
  const showSwitcher = role === 'owner' && workspaces.length > 1;
  // billing-exempt workspaces never see trial/paywall copy
  const planLine = ws?.active?.billingExempt ? 'Pro · Agency' : 'Free plan';

  const switchWorkspace = async (id) => {
    if (id === ws?.active?.id) return setWsOpen(false);
    try {
      await api.workspaceSelect(id);
      window.location.reload();
    } catch (err) {
      toast(err.message);
    }
  };

  const ctx = {
    status,
    role,
    workspace: ws?.active || null,
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
            <NavItems pathname={pathname} />
          </nav>
          <div className="sidebar-foot">
            {showSwitcher && wsOpen && (
              <div className="ws-menu" role="menu">
                {workspaces.map((w) => (
                  <button key={w.id} type="button" className={`ws-item${w.id === ws.active.id ? ' on' : ''}`} onClick={() => switchWorkspace(w.id)}>
                    <span className="dot" aria-hidden="true" />
                    {w.name}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="acct"
              onClick={() => (showSwitcher ? setWsOpen((v) => !v) : (window.location.href = '/settings.html'))}
              title={showSwitcher ? 'Switch workspace' : 'Account settings'}
            >
              <div className="avatar">{initials}</div>
              <div>
                <div className="acct-name">{ws?.active?.name || email || '…'}</div>
                <div className="acct-plan">{planLine}</div>
              </div>
            </button>
            <button type="button" className="ws-item" onClick={() => (window.location.href = '/settings.html')}>
              Settings
            </button>
            <a className="ws-item" href="/.netlify/functions/logout">
              Log out
            </a>
          </div>
        </aside>

        <div className="main">
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
            <div className="topbar-right">
              <button type="button" className="sbtn sbtn-primary sbtn-sm" onClick={() => toast('Shareable report links are coming soon.')}>
                Share report
              </button>
            </div>
          </header>
          <main className="content">
            <div className="tab-pane">{children}</div>
          </main>
          <nav className="mobile-nav" aria-label="Main navigation">
            <NavItems pathname={pathname} mobile />
          </nav>
        </div>
      </div>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </ShellContext.Provider>
  );
}
