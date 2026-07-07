// Shared helpers for the Google Ads API (reporting), reusing the same OAuth
// tokens the existing Google connect flow already stores - no separate auth.
// Every call needs the developer token from GOOGLE_ADS_DEVELOPER_TOKEN on
// top of the customer's OAuth token; with a test-access token Google only
// answers for test accounts, so production data needs Basic access approval.
//
// Google sunsets each API major version ~a year after release, and a dead
// version fails every call outright (this is how v17 silently broke account
// listing). Keep the version in this one constant and bump it before the
// sunset date.
const { googleApi } = require('./_google');

const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v22';

// One GAQL search against a customer (ad account). Returns the result rows;
// throws with Google's own message so callers can log/surface it.
async function gadsSearch(google, customerId, query) {
  const { status, json, tokenRefreshed } = await googleApi(google, {
    url: `${GOOGLE_ADS_API}/customers/${customerId}/googleAds:search`,
    method: 'POST',
    body: { query },
    headers: { 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '' }
  });
  if (status !== 200) {
    const detail =
      (json.error && (json.error.message || (json.error.details || [])[0]?.errors?.[0]?.message)) ||
      `Google Ads API returned ${status}`;
    const err = new Error(detail);
    err.tokenRefreshed = tokenRefreshed;
    throw err;
  }
  return { results: json.results || [], tokenRefreshed };
}

// The account IDs this Google user can access directly. Same endpoint the
// connect callback uses, kept here so the API version lives in one place.
async function listAccessibleCustomers(google) {
  const { status, json, tokenRefreshed } = await googleApi(google, {
    url: `${GOOGLE_ADS_API}/customers:listAccessibleCustomers`,
    headers: { 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '' }
  });
  if (status !== 200) {
    throw new Error((json.error && json.error.message) || `Google Ads API returned ${status}`);
  }
  const ids = (json.resourceNames || []).map((rn) => rn.split('/')[1]);
  return { ids, tokenRefreshed };
}

// Daily spend/delivery/conversions for one account and window, keyed by day.
// REST responses use camelCase and int64 metrics arrive as strings.
async function fetchGoogleDaily(google, customerId, since, until) {
  const query =
    'SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ' +
    `FROM customer WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const { results, tokenRefreshed } = await gadsSearch(google, customerId, query);

  const byDate = {};
  const totals = { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
  results.forEach((row) => {
    const m = row.metrics || {};
    const day = {
      spend: Number(m.costMicros || 0) / 1e6,
      impressions: parseInt(m.impressions || 0, 10),
      clicks: parseInt(m.clicks || 0, 10),
      conversions: Number(m.conversions || 0)
    };
    const date = row.segments && row.segments.date;
    if (date) byDate[date] = day;
    totals.spend += day.spend;
    totals.impressions += day.impressions;
    totals.clicks += day.clicks;
    totals.conversions += day.conversions;
  });
  return { byDate, totals, tokenRefreshed };
}

module.exports = { GOOGLE_ADS_API, gadsSearch, listAccessibleCustomers, fetchGoogleDaily };
