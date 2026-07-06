import { Link, useLocation } from 'react-router-dom';
import './TopNav.css';

const TABS = [
  { to: '/dashboard.html', label: 'Dashboard' },
  { to: '/reports.html', label: 'Reports & Insights' },
  { to: '/assistant.html', label: 'Assistant' },
  { to: '/settings.html', label: 'Settings' }
];

export default function TopNav({ email }) {
  const { pathname } = useLocation();

  return (
    <header className="top-nav">
      <div className="top-nav-inner">
        <div className="top-nav-brand">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--series-1)" />
            <path
              d="M7 21 L13 13 L18 18 L25 8"
              stroke="#fff"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>AdPulse</span>
        </div>
        <nav className="top-nav-tabs" aria-label="Main">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              className={`top-nav-tab${pathname === t.to ? ' active' : ''}`}
              aria-current={pathname === t.to ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="top-nav-actions">
          {email && <span className="top-nav-email">{email}</span>}
          <a className="top-nav-logout" href="/.netlify/functions/logout">
            Log out
          </a>
        </div>
      </div>
    </header>
  );
}
