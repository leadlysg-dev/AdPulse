// Deterministic demo data so the dashboard never looks broken before a
// customer connects an ad account. The numbers are generated from smooth
// waves (no randomness) so they stay stable between page loads. Demo mode
// shows two tracked metrics (Leads + Purchases) so the configurable-metrics
// feature is visible before anything is connected.
const { resolveRange, resolveCustomRange, listDays } = require('./_dates');

const DEMO_METRICS = [
  { id: 'lead', label: 'Leads' },
  { id: 'purchase', label: 'Purchases' }
];

function demoDay(i, scale, phase) {
  return Math.max(0, Math.round(scale * (1 + 0.45 * Math.sin(i / 3 + phase)) + (i % 5) * 0.4));
}

function demoDashboard(range) {
  const { since, until, prevSince, prevUntil } = resolveRange(range);
  const dates = listDays(since, until);

  const spendDaily = dates.map((_, i) => Math.round(112 + 30 * Math.sin(i / 4 + 1) + (i % 7) * 6));
  const totalSpend = spendDaily.reduce((a, b) => a + b, 0);

  // Delivery + revenue follow spend with their own gentle waves, so the demo
  // CTR sits around 3% and ROAS around 2x - believable, not flattering.
  const impressionsDaily = spendDaily.map((s, i) => Math.round(s * (36 + 5 * Math.sin(i / 5))));
  const clicksDaily = impressionsDaily.map((n, i) => Math.round(n * (0.028 + 0.006 * Math.sin(i / 6 + 2))));
  const revenueDaily = spendDaily.map((s, i) => Math.round(s * (2.0 + 0.5 * Math.sin(i / 5 + 1))));
  const lpvDaily = clicksDaily.map((c, i) => Math.round(c * (0.72 + 0.08 * Math.sin(i / 4))));
  const totalImpressions = impressionsDaily.reduce((a, b) => a + b, 0);
  const totalClicks = clicksDaily.reduce((a, b) => a + b, 0);
  const totalRevenue = revenueDaily.reduce((a, b) => a + b, 0);
  const totalLpv = lpvDaily.reduce((a, b) => a + b, 0);

  const metrics = DEMO_METRICS.map((m, mi) => {
    const scale = mi === 0 ? 5 : 2;
    const daily = dates.map((_, i) => demoDay(i, scale, mi * 2));
    const value = daily.reduce((a, b) => a + b, 0);
    // Prior period ran a little worse, so the demo insights have a story.
    const previous = Math.round(value * (mi === 0 ? 0.88 : 0.95));
    const prevSpend = Math.round(totalSpend * 0.97);
    return {
      id: m.id,
      label: m.label,
      value,
      previous,
      costPer: value ? +(totalSpend / value).toFixed(2) : 0,
      prevCostPer: previous ? +(prevSpend / previous).toFixed(2) : 0,
      daily
    };
  });

  return {
    isDemo: true,
    range,
    since,
    until,
    prevSince,
    prevUntil,
    spend: totalSpend,
    metaSpend: Math.round(totalSpend * 0.63),
    googleSpend: Math.round(totalSpend * 0.37),
    impressions: totalImpressions,
    clicks: totalClicks,
    landingPageViews: totalLpv,
    revenue: totalRevenue,
    previous: {
      spend: Math.round(totalSpend * 0.97),
      impressions: Math.round(totalImpressions * 1.02),
      clicks: Math.round(totalClicks * 0.93),
      landingPageViews: Math.round(totalLpv * 0.91),
      revenue: Math.round(totalRevenue * 0.9)
    },
    metrics,
    daily: {
      dates,
      spend: spendDaily,
      impressions: impressionsDaily,
      clicks: clicksDaily,
      landingPageViews: lpvDaily,
      revenue: revenueDaily
    }
  };
}

function demoHistory(weeks = 12) {
  const now = Date.now();
  const list = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now - i * 7 * 86400000);
    const start = new Date(end.getTime() - 6 * 86400000);
    const n = weeks - i;
    const leads = Math.round(26 + 8 * Math.sin(n / 2) + n * 0.8);
    const purchases = Math.round(9 + 3 * Math.sin(n / 2.2 + 1) + n * 0.3);
    const spend = Math.round(760 + 90 * Math.sin(n / 2.5) + n * 14);
    const impressions = Math.round(spend * 37);
    const clicks = Math.round(impressions * 0.03);
    list.push({
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      spend,
      impressions,
      clicks,
      revenue: Math.round(spend * 2.1),
      values: { lead: leads, purchase: purchases }
    });
  }
  return { isDemo: true, metrics: DEMO_METRICS, weeks: list };
}

function demoAds(range) {
  return {
    isDemo: true,
    range,
    metrics: DEMO_METRICS,
    ads: [
      {
        id: 'demo-1',
        name: 'Spring offer — lead form',
        headline: 'Book your free consultation',
        body: 'Limited slots this month. Tell us what you need and we’ll call you back the same day.',
        thumbnailUrl: null,
        spend: 1240,
        values: { lead: 52, purchase: 11 }
      },
      {
        id: 'demo-2',
        name: 'Testimonial video — retargeting',
        headline: '"They doubled our enquiries in 6 weeks"',
        body: 'Hear how local businesses grew with us. Watch the 30-second story.',
        thumbnailUrl: null,
        spend: 860,
        values: { lead: 31, purchase: 14 }
      },
      {
        id: 'demo-3',
        name: 'Evergreen brand — broad reach',
        headline: 'The easier way to get more customers',
        body: 'No contracts, cancel anytime. See plans and pricing.',
        thumbnailUrl: null,
        spend: 410,
        values: { lead: 9, purchase: 2 }
      }
    ]
  };
}

function demoSeo(range, custom) {
  const { since, until } = custom || resolveRange(range === 'custom' ? 'last_30d' : range);
  const dates = listDays(since, until);
  const clicks = dates.map((_, i) => Math.round(38 + 9 * Math.sin(i / 4 + 1) + (i % 5)));
  const impressions = clicks.map((c, i) => Math.round(c * (34 + 4 * Math.sin(i / 6))));
  const avgPosition = dates.map((_, i) => +(14.5 - i * 0.04 + 1.2 * Math.sin(i / 5)).toFixed(1));
  const totalClicks = clicks.reduce((a, b) => a + b, 0);
  const totalImpr = impressions.reduce((a, b) => a + b, 0);
  const row = (key, share, pos) => ({
    key,
    clicks: Math.round(totalClicks * share),
    impressions: Math.round(totalImpr * share),
    ctrPct: +(((totalClicks * share) / (totalImpr * share)) * 100).toFixed(2),
    avgPosition: pos
  });
  return {
    range,
    since,
    until,
    siteUrl: 'sc-domain:example.com',
    totals: {
      clicks: totalClicks,
      impressions: totalImpr,
      ctrPct: +((totalClicks / totalImpr) * 100).toFixed(2),
      avgPosition: 12.4
    },
    previous: {
      clicks: Math.round(totalClicks * 0.91),
      impressions: Math.round(totalImpr * 0.96),
      ctrPct: +((totalClicks * 0.91) / (totalImpr * 0.96) * 100).toFixed(2),
      avgPosition: 13.8
    },
    daily: { dates, clicks, impressions, avgPosition },
    topQueries: [
      row('ad reporting dashboard', 0.16, 4.2),
      row('meta ads report tool', 0.11, 6.8),
      row('cost per lead calculator', 0.09, 8.1),
      row('google ads dashboard for small business', 0.07, 9.4),
      row('facebook ads reporting', 0.06, 11.2),
      row('leadly', 0.05, 1.1),
      row('marketing report template', 0.04, 14.6),
      row('roas tracker', 0.03, 12.9)
    ],
    topPages: [
      row('https://example.com/', 0.24, 5.3),
      row('https://example.com/features', 0.13, 7.9),
      row('https://example.com/pricing', 0.1, 6.4),
      row('https://example.com/blog/cost-per-lead', 0.08, 9.8),
      row('https://example.com/blog/meta-vs-google-ads', 0.06, 11.5),
      row('https://example.com/templates', 0.04, 13.2)
    ]
  };
}

module.exports = { demoDashboard, demoHistory, demoAds, demoSeo, DEMO_METRICS };
