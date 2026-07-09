// Google Business Profile helpers. GBP is its own connection (provider
// 'gbp') with its own OAuth consent (business.manage scope) - separate from
// the Google Ads connection, sharing only the client id. Every GBP API
// starts with ZERO quota until Google approves the project's access
// request, so every caller must treat 403 accessNotConfigured / 429 as
// "access pending", not as a bug.
const { googleApi } = require('./_google');

const SCOPE = 'https://www.googleapis.com/auth/business.manage';

// Distinguish "Google hasn't approved this project's GBP access yet" from
// real errors, so the UI can explain instead of breaking.
function accessState(status, json) {
  if (status === 200) return 'ok';
  const err = (json && json.error) || {};
  const reason =
    (err.errors && err.errors[0] && err.errors[0].reason) ||
    (err.details && err.details[0] && err.details[0].reason) ||
    err.status ||
    '';
  const msg = err.message || '';
  if (
    status === 429 ||
    /accessNotConfigured|rateLimitExceeded|RESOURCE_EXHAUSTED|quota/i.test(`${reason} ${msg}`)
  ) {
    return 'api-pending';
  }
  if (status === 401 || status === 403) return 'denied';
  return 'error';
}

// Every location this GBP user manages, flattened across their accounts.
// Ids are the full v4 review path ("accounts/A/locations/L") so one stored
// id serves both the performance (locations/L) and reviews (full path) APIs.
async function listGbpLocations(gbp) {
  const acc = await googleApi(gbp, { url: 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts' });
  const accState = accessState(acc.status, acc.json);
  if (accState !== 'ok') return { locations: null, state: accState, detail: JSON.stringify(acc.json.error || {}) };

  const locations = [];
  for (const account of (acc.json.accounts || []).slice(0, 5)) {
    const res = await googleApi(gbp, {
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`
    });
    if (res.status !== 200) continue;
    (res.json.locations || []).forEach((loc) => {
      locations.push({ id: `${account.name}/${loc.name}`, name: loc.title || loc.name });
    });
  }
  return { locations, state: 'ok' };
}

const DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS'
];

const datePart = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m, day: d };
};

// Daily performance series for one location and window.
// locationPath is "accounts/A/locations/L"; performance wants "locations/L".
async function fetchGbpPerformance(gbp, locationPath, since, until) {
  const loc = locationPath.split('/').slice(-2).join('/');
  const s = datePart(since);
  const u = datePart(until);
  const params = new URLSearchParams();
  DAILY_METRICS.forEach((m) => params.append('dailyMetrics', m));
  params.set('dailyRange.start_date.year', s.year);
  params.set('dailyRange.start_date.month', s.month);
  params.set('dailyRange.start_date.day', s.day);
  params.set('dailyRange.end_date.year', u.year);
  params.set('dailyRange.end_date.month', u.month);
  params.set('dailyRange.end_date.day', u.day);
  const res = await googleApi(gbp, {
    url: `https://businessprofileperformance.googleapis.com/v1/${loc}:fetchMultiDailyMetricsTimeSeries?${params}`
  });
  const state = accessState(res.status, res.json);
  if (state !== 'ok') return { state, detail: JSON.stringify(res.json.error || {}) };

  const totals = {};
  const daily = {};
  (res.json.multiDailyMetricTimeSeries || []).forEach((group) => {
    (group.dailyMetricTimeSeries || []).forEach((series) => {
      const key = series.dailyMetric;
      totals[key] = 0;
      daily[key] = {};
      ((series.timeSeries && series.timeSeries.datedValues) || []).forEach((dv) => {
        const v = Number(dv.value || 0);
        totals[key] += v;
        if (dv.date) {
          const iso = `${dv.date.year}-${String(dv.date.month).padStart(2, '0')}-${String(dv.date.day).padStart(2, '0')}`;
          daily[key][iso] = v;
        }
      });
    });
  });
  return { state: 'ok', totals, daily };
}

const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

// Most recent reviews, newest first, with any existing owner reply.
async function fetchGbpReviews(gbp, locationPath, pageSize = 10) {
  const res = await googleApi(gbp, {
    url: `https://mybusiness.googleapis.com/v4/${locationPath}/reviews?pageSize=${pageSize}&orderBy=updateTime%20desc`
  });
  const state = accessState(res.status, res.json);
  if (state !== 'ok') return { state, detail: JSON.stringify(res.json.error || {}) };
  return {
    state: 'ok',
    averageRating: res.json.averageRating || null,
    totalReviewCount: res.json.totalReviewCount || 0,
    reviews: (res.json.reviews || []).map((r) => ({
      id: r.reviewId,
      reviewer: (r.reviewer && r.reviewer.displayName) || 'A customer',
      rating: STARS[r.starRating] || null,
      comment: r.comment || '',
      createTime: r.createTime,
      reply: (r.reviewReply && r.reviewReply.comment) || null
    }))
  };
}

// Post (or overwrite) the owner reply on one review. Supported by the v4
// API for verified locations.
async function replyToReview(gbp, locationPath, reviewId, comment) {
  const res = await googleApi(gbp, {
    url: `https://mybusiness.googleapis.com/v4/${locationPath}/reviews/${encodeURIComponent(reviewId)}/reply`,
    method: 'PUT',
    body: { comment }
  });
  return { state: accessState(res.status, res.json), detail: JSON.stringify(res.json.error || {}) };
}

module.exports = { SCOPE, listGbpLocations, fetchGbpPerformance, fetchGbpReviews, replyToReview, accessState };
