import { Link } from 'react-router-dom';
import './LockedSection.css';

// Pro-gated content: the real section renders underneath, blurred and
// inert, with an upgrade overlay on top. Everyone is on the free plan for
// now, so this is purely presentational - no entitlement check yet.
export default function LockedSection({ title, children }) {
  return (
    <div className="locked-section">
      <div className="locked-content" aria-hidden="true">
        {children}
      </div>
      <div className="locked-overlay">
        <div className="locked-overlay-card card">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="locked-overlay-title">Pro analytics</span>
          <span className="locked-overlay-sub">Upgrade to unlock {title}.</span>
          <Link className="btn btn-primary locked-overlay-btn" to="/upgrade.html">
            Upgrade
          </Link>
        </div>
      </div>
    </div>
  );
}
