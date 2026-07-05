import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/global.css';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SelectAccount from './pages/SelectAccount';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        {/* Paths keep the .html suffix because the Netlify Functions backend
            (auth-meta-callback, auth-google-callback, login, etc.) redirects
            to these exact hardcoded paths - changing them would require
            touching backend code, which is out of scope for this rebuild. */}
        <Route path="/login.html" element={<Login />} />
        <Route path="/dashboard.html" element={<Dashboard />} />
        <Route path="/select-account.html" element={<SelectAccount />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
