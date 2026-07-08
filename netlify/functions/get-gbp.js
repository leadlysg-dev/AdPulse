// Local SEO data for the SEO tab: Business Profile performance metrics and
// recent reviews for the selected location and date range.
// Response state: not-connected (demo) | needs-location | api-pending |
// unavailable | ok.
const { getEmailFromRequest, getUser, saveUser } = require('./_store');
const { VALID_RANGES, resolveRange, resolveCustomRange, listDays } = require('./_dates');
const { fetchGbpPerformance, fetchGbpReviews } = require('./_gbp');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function demoGbp(window, dates) {
  const wave = (i, b, a, f) => Math.max(0, Math.round(b + a * Math.sin(i / f)));
  const views = dates.map((_, i) => wave(i, 46, 14, 4));
  return {
    state: 'ok',
    isDemo: true,
    ...window,
    locationName: 'Sample business',
    metrics: {
      profileViews: views.reduce((a, b) => a + b, 0),
      searchAppearances: Math.round(views.reduce((a, b) => a + b, 0) * 0.7),
      mapsViews: Math.round(views.reduce((a, b) => a + b, 0) * 0.3),
      calls: 14,
      websiteClicks: 38,
      directionRequests: 22
    },
    averageRating: 4.6,
    totalReviewCount: 31,
    reviews: [
      { id: 'demo1', reviewer: 'Sarah L.', rating: 5, comment: 'Fast, friendly and great value. Highly recommend!', createTime: `${window.until}T10:00:00Z`, reply: 'Thanks Sarah - see you again soon!' },
      { id: 'demo2', reviewer: 'Marcus T.', rating: 4, comment: 'Good service overall, slight wait at peak hours.', createTime: `${window.since}T14:00:00Z`, reply: null },
      { id: 'demo3', reviewer: 'Priya N.', rating: 5, comment: 'The team went out of their way to help. 10/10.', createTime: `${window.since}T09:00:00Z`, reply: null }
    ]
  };
}

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const user = await getUser(email);
  if (!user) return json(401, { error: 'Not logged in.' });

  const qs = event.queryStringParameters || {};
  const custom = resolveCustomRange(qs.since, qs.until);
  const range = custom ? 'custom' : VALID_RANGES.includes(qs.range) ? qs.range : 'last_30d';
  const { since, until } = custom || resolveRange(range);
  const window = { range, since, until };
  const dates = listDays(since, until);

  const gbp = user.accounts.gbp;
  if (!gbp) return json(200, demoGbp(window, dates));

  if (!gbp.selectedAdAccountId) {
    if (!(gbp.adAccounts || []).length) {
      // Connected but listing came back empty - almost always pending API
      // approval rather than a business with zero locations.
      return json(200, { state: 'api-pending', ...window });
    }
    return json(200, { state: 'needs-location', properties: gbp.adAccounts, ...window });
  }

  try {
    const location = (gbp.adAccounts || []).find((l) => l.id === gbp.selectedAdAccountId);
    const [perf, reviews] = await Promise.all([
      fetchGbpPerformance(gbp, gbp.selectedAdAccountId, since, until),
      fetchGbpReviews(gbp, gbp.selectedAdAccountId, 10)
    ]);
    await saveUser(user).catch(() => {}); // persist any refreshed token

    if (perf.state === 'api-pending' && reviews.state === 'api-pending') {
      console.error(`[get-gbp] access pending: ${perf.detail}`);
      return json(200, { state: 'api-pending', ...window });
    }

    const t = perf.state === 'ok' ? perf.totals : {};
    const searchViews = (t.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) + (t.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0);
    const mapsViews = (t.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) + (t.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0);

    if (perf.state !== 'ok') console.error(`[get-gbp] performance ${perf.state}: ${perf.detail}`);
    if (reviews.state !== 'ok') console.error(`[get-gbp] reviews ${reviews.state}: ${reviews.detail}`);
    if (perf.state !== 'ok' && reviews.state !== 'ok') {
      return json(200, { state: 'unavailable', ...window });
    }

    return json(200, {
      state: 'ok',
      isDemo: false,
      ...window,
      locationName: (location && location.name) || '',
      metrics: perf.state === 'ok'
        ? {
            profileViews: searchViews + mapsViews,
            searchAppearances: searchViews,
            mapsViews,
            calls: t.CALL_CLICKS || 0,
            websiteClicks: t.WEBSITE_CLICKS || 0,
            directionRequests: t.BUSINESS_DIRECTION_REQUESTS || 0
          }
        : null,
      averageRating: reviews.state === 'ok' ? reviews.averageRating : null,
      totalReviewCount: reviews.state === 'ok' ? reviews.totalReviewCount : 0,
      reviews: reviews.state === 'ok' ? reviews.reviews : []
    });
  } catch (err) {
    console.error(`[get-gbp] failed: ${err.message}`);
    return json(200, { state: 'unavailable', ...window });
  }
};
