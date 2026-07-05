import { Link } from 'react-router-dom';
import './Landing.css';

export default function Landing() {
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="landing-brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--series-1)" />
            <path d="M7 21 L13 13 L18 18 L25 8" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>AdPulse</span>
        </div>

        <h1>See every lead and every ad dollar, in one dashboard</h1>
        <p className="landing-sub">
          Connect your Meta and Google ad accounts. No API keys to copy, no spreadsheets to update — it just stays current.
        </p>

        <div className="landing-actions">
          <Link className="btn btn-primary" to="/login.html">
            Create account / log in
          </Link>
          <Link className="btn btn-secondary" to="/dashboard.html">
            Go to my dashboard →
          </Link>
        </div>

        <div className="landing-steps">
          <div className="card landing-step">
            <span className="landing-step-num">1</span>
            <div>
              <h2>Create your account</h2>
              <p>One email and password — this is how you'll always get back to your dashboard, from any device.</p>
            </div>
          </div>
          <div className="card landing-step">
            <span className="landing-step-num">2</span>
            <div>
              <h2>Connect your ad accounts</h2>
              <p>Sign in with Meta and Google directly — AdPulse never sees or stores your passwords.</p>
            </div>
          </div>
          <div className="card landing-step">
            <span className="landing-step-num">3</span>
            <div>
              <h2>Watch your numbers update automatically</h2>
              <p>Leads, spend, and cost per lead, refreshed every time you check in.</p>
            </div>
          </div>
        </div>

        <p className="landing-footnote">
          By connecting an account you're only granting read-access to reporting data — AdPulse cannot create, edit, or spend on your campaigns.
        </p>
      </div>
    </div>
  );
}
