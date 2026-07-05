// Thin wrapper over fetch for the existing Netlify Functions. Every endpoint,
// method, body shape, and cookie-based session stays exactly as the backend
// expects - this only adds consistent error handling for the UI.

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

  getDashboardData: (range) =>
    request(`/.netlify/functions/get-dashboard-data?range=${encodeURIComponent(range)}`),

  getHistory: () => request('/.netlify/functions/get-history'),

  getAds: (range) => request(`/.netlify/functions/get-ads?range=${encodeURIComponent(range)}`),

  listAccounts: () => request('/.netlify/functions/list-accounts'),

  selectAccount: (provider, accountId) =>
    request('/.netlify/functions/select-account', {
      method: 'POST',
      body: JSON.stringify({ provider, accountId })
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
    })
};

export { ApiError };
