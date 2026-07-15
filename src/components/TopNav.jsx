import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import './TopNav.css';

const TABS = [
  { to: '/pulse.html', label: 'PulseAI' },
  { to: '/reporting.html', label: 'Reporting' },
  { to: '/manage.html', label: 'Manage' },
  { to: '/creative.html', label: 'Creative' },
  { to: '/studio.html', label: 'Leadly Studio' },
  { to: '/seo.html', label: 'Local SEO' },
  { to: '/settings.html', label: 'Settings' }
];

export default function TopNav({ email }) {
  const { pathname } = useLocation();
  // Until the real logo file lands at public/assets/leadly-logo.svg, the
  // brand falls back to a text wordmark - never a broken image.
  const [logoMissing, setLogoMissing] = useState(false);

  return (
    <header className="top-nav">
      <div className="top-nav-inner">
        <div className="top-nav-brand">
          {logoMissing ? (
            <span className="top-nav-leadly">Leadly</span>
          ) : (
            <img
              className="top-nav-logo"
              src="/assets/leadly-logo.svg"
              alt="Leadly"
              onError={() => setLogoMissing(true)}
            />
          )}
          <span className="top-nav-product">Pulse</span>
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
          {/* Until the session check answers, hold the email's spot with a
              same-height placeholder so the bar doesn't reflow on load. */}
          {email ? (
            <span className="top-nav-email">{email}</span>
          ) : (
            <span className="skeleton top-nav-email-skeleton" aria-hidden="true" />
          )}
          <a className="top-nav-logout" href="/.netlify/functions/logout">
            Log out
          </a>
        </div>
      </div>
    </header>
  );
}
