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

async function request(path, options = {}) {
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

  getDashboardData: (view, channel = 'all') =>
    request(
      `/.netlify/functions/get-dashboard-data?${viewQuery(view)}&channel=${encodeURIComponent(channel)}`
    ),

  getHistory: () => request('/.netlify/functions/get-history'),

  getReport: (view) => request(`/.netlify/functions/get-report?${viewQuery(view)}`),

  getAds: (view) => request(`/.netlify/functions/get-ads?${viewQuery(view)}`),

  getManageTree: (view, channel) =>
    request(`/.netlify/functions/get-manage-tree?${viewQuery(view)}&channel=${encodeURIComponent(channel)}`),

  manageEntity: (payload) =>
    request('/.netlify/functions/manage-entity', { method: 'POST', body: JSON.stringify(payload) }),

  manageBulk: (payload) =>
    request('/.netlify/functions/manage-bulk', { method: 'POST', body: JSON.stringify(payload) }),

  getAuditLog: () => request('/.netlify/functions/get-audit-log'),

  listAccounts: () => request('/.netlify/functions/list-accounts'),

  selectAccount: (provider, accountId) =>
    request('/.netlify/functions/select-account', {
      method: 'POST',
      body: JSON.stringify({ provider, accountId })
    }),

  listMetrics: (provider) =>
    request(`/.netlify/functions/list-metrics?provider=${encodeURIComponent(provider)}`),

  selectMetrics: (provider, metrics) =>
    request('/.netlify/functions/select-metrics', {
      method: 'POST',
      body: JSON.stringify({ provider, metrics })
    }),

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

  saveAiPrefs: (prefs) =>
    request('/.netlify/functions/save-ai-prefs', {
      method: 'POST',
      body: JSON.stringify(prefs)
    }),

  getAiInsights: (range, refresh = false, check = false) =>
    request(
      `/.netlify/functions/get-ai-insights?range=${encodeURIComponent(range)}${refresh ? '&refresh=1' : ''}${check ? '&check=1' : ''}`
    ),

  createAlert: (rule) =>
    request('/.netlify/functions/create-alert', {
      method: 'POST',
      body: JSON.stringify(rule)
    }),

  disconnectProvider: (provider) =>
    request('/.netlify/functions/disconnect-provider', {
      method: 'POST',
      body: JSON.stringify({ provider })
    }),

  getSeo: (view) => request(`/.netlify/functions/get-seo?${viewQuery(view)}`),

  getGbp: (view) => request(`/.netlify/functions/get-gbp?${viewQuery(view)}`),

  selectGbpLocation: (locationId) =>
    request('/.netlify/functions/select-gbp-location', {
      method: 'POST',
      body: JSON.stringify({ locationId })
    }),

  replyReview: (reviewId, comment) =>
    request('/.netlify/functions/reply-review', {
      method: 'POST',
      body: JSON.stringify({ reviewId, comment })
    }),

  selectScProperty: (siteUrl) =>
    request('/.netlify/functions/select-sc-property', {
      method: 'POST',
      body: JSON.stringify({ siteUrl })
    }),

  assistantChat: (messages) =>
    request('/.netlify/functions/assistant-chat', {
      method: 'POST',
      body: JSON.stringify({ messages })
    }),

  studioInit: () => request('/.netlify/functions/studio-init'),

  studioBalance: () => request('/.netlify/functions/studio-balance'),

  studioJobs: (project) =>
    request(`/.netlify/functions/studio-jobs?project=${encodeURIComponent(project || '')}`),

  studioJob: (id) => request(`/.netlify/functions/studio-job?id=${encodeURIComponent(id)}`),

  studioCreate: (body) =>
    request('/.netlify/functions/studio-create', { method: 'POST', body: JSON.stringify(body) }),

  studioRetry: (jobId, placement) =>
    request('/.netlify/functions/studio-retry', {
      method: 'POST',
      body: JSON.stringify({ jobId, placement })
    }),

  studioEdit: (body) =>
    request('/.netlify/functions/studio-edit', { method: 'POST', body: JSON.stringify(body) }),

  studioChain: (id) => request(`/.netlify/functions/studio-chain?id=${encodeURIComponent(id)}`),

  studioAnimate: (body) =>
    request('/.netlify/functions/studio-animate', { method: 'POST', body: JSON.stringify(body) }),

  studioMotion: (id) => request(`/.netlify/functions/studio-motion?id=${encodeURIComponent(id)}`),

  studioExpand: (body) =>
    request('/.netlify/functions/studio-expand', { method: 'POST', body: JSON.stringify(body) }),

  studioExpandEdit: (body) =>
    request('/.netlify/functions/studio-expand-edit', { method: 'POST', body: JSON.stringify(body) }),

  studioUpload: (files, target) =>
    request('/.netlify/functions/studio-upload', {
      method: 'POST',
      body: JSON.stringify({ files, target })
    }),

  studioLibrary: () => request('/.netlify/functions/studio-library'),

  listAlerts: () => request('/.netlify/functions/list-alerts'),

  updateAlert: (id, enabled) =>
    request('/.netlify/functions/update-alert', {
      method: 'POST',
      body: JSON.stringify({ id, enabled })
    }),

  deleteAlert: (id) =>
    request('/.netlify/functions/delete-alert', {
      method: 'POST',
      body: JSON.stringify({ id })
    })
};

export { ApiError };
