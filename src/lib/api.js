// Thin wrapper over fetch for the existing Netlify Functions. Every endpoint,
// method, body shape, and cookie-based session stays exactly as the backend
// expects - this only adds consistent error handling for the UI.

// A "view" is either a named range ('last_7d', ...) or a custom
// { since, until } pair from the date picker.
const viewQuery = (view) =>
  typeof view === 'string'
    ? `range=${encodeURIComponent(view)}`
    : `since=${encodeURIComponent(view.since)}&until=${encodeURIComponent(view.until)}`;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// On /demo routes every call is answered locally by the demo adapter
// (reads from fixtures, writes blocked, pulse-chat passed through flagged
// as demo). The adapter is imported on demand, so authenticated sessions
// never download the demo code and their requests go straight to fetch.
const onDemoRoute = () => typeof window !== 'undefined' && /^\/demo(\/|$)/.test(window.location.pathname);

async function request(path, options = {}) {
  if (onDemoRoute()) {
    const { demoRequest } = await import('../demo/adapter');
    return demoRequest(path, options, networkRequest);
  }
  return networkRequest(path, options);
}

async function networkRequest(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new ApiError('Network error - check your connection and try again.', 0);
  }

  const text = await res.text();
  let data = null;
  let parseFailed = false;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      parseFailed = true;
    }
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status}).`;
    throw new ApiError(message, res.status);
  }

  if (parseFailed) {
    throw new ApiError('Received an unexpected response - please try again.', res.status);
  }

  return data;
}

export const api = {
  getStatus: () => request('/.netlify/functions/get-status'),

  getReport: (view) => request(`/.netlify/functions/get-report?${viewQuery(view)}`),

  getManageTree: (view, channel) =>
    request(`/.netlify/functions/get-manage-tree?${viewQuery(view)}&channel=${encodeURIComponent(channel)}`),

  manageEntity: (payload) =>
    request('/.netlify/functions/manage-entity', { method: 'POST', body: JSON.stringify(payload) }),

  manageBulk: (payload) =>
    request('/.netlify/functions/manage-bulk', { method: 'POST', body: JSON.stringify(payload) }),

  listAccounts: () => request('/.netlify/functions/list-accounts'),

  selectAccount: (provider, accountId) =>
    request('/.netlify/functions/select-account', {
      method: 'POST',
      body: JSON.stringify({ provider, accountId })
    }),

  listMetrics: (provider) =>
    request(`/.netlify/functions/list-metrics?provider=${encodeURIComponent(provider)}`),

  setGoal: (provider, metricId, targetCostPer) =>
    request('/.netlify/functions/set-goal', {
      method: 'POST',
      body: JSON.stringify({ provider, metricId, targetCostPer })
    }),

  login: (email, password) =>
    request('/.netlify/functions/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),

  signup: (email, password) =>
    request('/.netlify/functions/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),

  changePassword: (currentPassword, newPassword) =>
    request('/.netlify/functions/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    }),

  getAiInsights: (range, refresh = false, check = false) =>
    request(
      `/.netlify/functions/get-ai-insights?range=${encodeURIComponent(range)}${refresh ? '&refresh=1' : ''}${check ? '&check=1' : ''}`
    ),

  disconnectProvider: (provider) =>
    request('/.netlify/functions/disconnect-provider', {
      method: 'POST',
      body: JSON.stringify({ provider })
    }),

  metricsConfig: () => request('/.netlify/functions/metrics-config'),

  metricsConfigSave: (config) =>
    request('/.netlify/functions/metrics-config', { method: 'POST', body: JSON.stringify({ config }) }),

  getHeatmap: (view, platform = 'all') =>
    request(`/.netlify/functions/get-heatmap?${viewQuery(view)}&platform=${encodeURIComponent(platform)}`),

  pulseChat: (payload) =>
    request('/.netlify/functions/pulse-chat', { method: 'POST', body: JSON.stringify(payload) }),

  pulseChips: () => request('/.netlify/functions/pulse-chips')

};

export { ApiError };
