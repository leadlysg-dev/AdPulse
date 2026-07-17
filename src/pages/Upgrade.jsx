import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import './Upgrade.css';

const PRO_FEATURES = [
  'Advanced interactive visualizations',
  'Daily trend & cost charts',
  'Best-campaign highlights',
  'Weekly history & exports',
  'Priority AI insights'
];

// Placeholder plans page - everyone is on the free plan today and there is
// no checkout yet. This page exists so upgrade CTAs have somewhere honest
// to land.
export default function Upgrade() {
  const [status, setStatus] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.getStatus();
      if (!s.loggedIn) {
        setRedirecting(true);
        window.location.href = '/login.html';
        return;
      }
      setStatus(s);
    } catch {
      /* the page still renders without status */
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (redirecting) return null;

  return (
    <div className="upgrade-page">
      <main className="upgrade-main">
        <h1>Plans</h1>
        <div className="upgrade-grid">
          <div className="card upgrade-plan">
            <span className="upgrade-plan-name">Free</span>
            <span className="upgrade-plan-price">$0</span>
            <span className="upgrade-plan-badge current">Your current plan</span>
            <ul className="upgrade-features">
              <li>Meta + Google Ads in one dashboard</li>
              <li>AI insights & alert assistant</li>
              <li>Creative gallery</li>
              <li>Local SEO & reviews</li>
            </ul>
          </div>
          <div className="card upgrade-plan pro">
            <span className="upgrade-plan-name">Pro</span>
            <span className="upgrade-plan-price">Coming soon</span>
            <span className="upgrade-plan-badge">Not available yet</span>
            <ul className="upgrade-features">
              {PRO_FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button type="button" className="btn btn-primary" disabled>
              Upgrade (coming soon)
            </button>
          </div>
        </div>
        <p className="upgrade-note">
          Pro isn't purchasable yet — pricing and checkout are on the way. Everything you use today
          stays free. <Link to="/pulse.html">Back to Pulse</Link>
        </p>
      </main>
    </div>
  );
}
