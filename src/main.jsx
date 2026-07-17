import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import './styles/global.css';
import { api } from './lib/api';
import Login from './pages/Login';
import Invite from './pages/Invite';
import Shell from './components/Shell';
import PulseTab from './pages/app/PulseTab';
import CampaignsTab from './pages/app/CampaignsTab';
import StudioTab from './pages/app/StudioTab';
import AutomationsTab from './pages/app/AutomationsTab';
import Settings from './pages/Settings';
import Seo from './pages/Seo';
import SelectAccount from './pages/SelectAccount';
import Upgrade from './pages/Upgrade';

// "/" (and any unknown path) routes into the app: logged-in visitors go to
// Pulse, everyone else to login. Client-side Navigate, not a full page
// reload - a location.replace() fired mid-load can leave the next document
// blank in some browsers.
function RootRedirect() {
  const [to, setTo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getStatus()
      .then((s) => {
        if (!cancelled) setTo(s.loggedIn ? '/pulse.html' : '/login.html');
      })
      .catch(() => {
        if (!cancelled) setTo('/login.html');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return to ? <Navigate to={to} replace /> : null;
}

// Old tab URLs forward to their homes in the five-tab dashboard, keeping the
// query string - the backend (login, OAuth callbacks) still redirects to
// /dashboard.html and must keep working without backend changes.
function LegacyRedirect({ to }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

const tab = (title, node) => <Shell title={title}>{node}</Shell>;

// Every page answers on both "/x.html" and "/x". The .html forms are what
// the Netlify Functions backend redirects to (auth callbacks, login) and
// must never break; the clean forms are what people actually type.
const PAGES = [
  ['login', <Login />],
  ['invite', <Invite />],
  ['pulse', tab('Pulse', <PulseTab />)],
  ['campaigns', tab('Campaigns', <CampaignsTab />)],
  ['studio', tab('Studio', <StudioTab />)],
  ['automations', tab('Automations', <AutomationsTab />)],
  ['settings', tab('Settings', <Settings />)],
  ['seo', tab('Local SEO', <Seo />)],
  ['select-account', <SelectAccount />],
  ['upgrade', tab('Upgrade', <Upgrade />)]
];

const LEGACY = [
  ['dashboard', '/pulse.html'],
  ['reports', '/pulse.html'],
  ['reporting', '/pulse.html'],
  ['assistant', '/pulse.html'],
  ['manage', '/campaigns.html'],
  ['admanager', '/campaigns.html'],
  ['crm', '/pulse.html'],
  ['creative', '/pulse.html']
];

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        {PAGES.flatMap(([name, element]) => [
          <Route key={`${name}.html`} path={`/${name}.html`} element={element} />,
          <Route key={name} path={`/${name}`} element={element} />
        ])}
        {LEGACY.flatMap(([name, to]) => [
          <Route key={`${name}.html`} path={`/${name}.html`} element={<LegacyRedirect to={to} />} />,
          <Route key={name} path={`/${name}`} element={<LegacyRedirect to={to} />} />
        ])}
        {/* Anything unknown lands where "/" does - never a blank page. */}
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
