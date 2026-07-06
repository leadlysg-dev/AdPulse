import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/global.css';
import { api } from './lib/api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Assistant from './pages/Assistant';
import SelectAccount from './pages/SelectAccount';
import SelectMetrics from './pages/SelectMetrics';

// The marketing site is now the public front door, so "/" just routes into
// the app: logged-in visitors go to the dashboard, everyone else to login.
function RootRedirect() {
  useEffect(() => {
    let cancelled = false;
    api
      .getStatus()
      .then((s) => {
        if (!cancelled) window.location.replace(s.loggedIn ? '/dashboard.html' : '/login.html');
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
        <Route path="/dashboard.html" element={<Dashboard />} />
        <Route path="/reports.html" element={<Reports />} />
        <Route path="/settings.html" element={<Settings />} />
        <Route path="/assistant.html" element={<Assistant />} />
        <Route path="/select-account.html" element={<SelectAccount />} />
        <Route path="/select-metrics.html" element={<SelectMetrics />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
