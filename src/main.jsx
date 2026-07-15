import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import './styles/global.css';
import { api } from './lib/api';
import Login from './pages/Login';
import Pulse from './pages/Pulse';
import Reporting from './pages/Reporting';
import Creative from './pages/Creative';
import Settings from './pages/Settings';
import Seo from './pages/Seo';
import SelectAccount from './pages/SelectAccount';
import SelectMetrics from './pages/SelectMetrics';
import Upgrade from './pages/Upgrade';
import Manage from './pages/Manage';
import Studio from './pages/Studio';

// The marketing site is now the public front door, so "/" just routes into
// the app: logged-in visitors go to Pulse, everyone else to login.
function RootRedirect() {
  useEffect(() => {
    let cancelled = false;
    api
      .getStatus()
      .then((s) => {
        if (!cancelled) window.location.replace(s.loggedIn ? '/pulse.html' : '/login.html');
      })
      .catch(() => {
        if (!cancelled) window.location.replace('/login.html');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

// Old tab URLs forward to their new homes, keeping the query string - the
// backend (login, OAuth callbacks) still redirects to /dashboard.html and
// must keep working without backend changes.
function LegacyRedirect({ to }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        {/* Paths keep the .html suffix because the Netlify Functions backend
            (auth-meta-callback, auth-google-callback, login, etc.) redirects
            to these exact hardcoded paths - changing them would require
            touching backend code, which is out of scope for this rebuild. */}
        <Route path="/login.html" element={<Login />} />
        <Route path="/pulse.html" element={<Pulse />} />
        <Route path="/reporting.html" element={<Reporting />} />
        <Route path="/manage.html" element={<Manage />} />
        <Route path="/creative.html" element={<Creative />} />
        <Route path="/studio.html" element={<Studio />} />
        <Route path="/seo.html" element={<Seo />} />
        <Route path="/settings.html" element={<Settings />} />
        <Route path="/upgrade.html" element={<Upgrade />} />
        <Route path="/select-account.html" element={<SelectAccount />} />
        <Route path="/select-metrics.html" element={<SelectMetrics />} />
        <Route path="/dashboard.html" element={<LegacyRedirect to="/pulse.html" />} />
        <Route path="/reports.html" element={<LegacyRedirect to="/reporting.html" />} />
        <Route path="/assistant.html" element={<LegacyRedirect to="/pulse.html" />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
