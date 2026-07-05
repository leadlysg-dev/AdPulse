// Deterministic demo data so the dashboard never looks broken before a
// customer connects an ad account. The numbers are generated from smooth
// waves (no randomness) so they stay stable between page loads. Demo mode
// shows two tracked metrics (Leads + Purchases) so the configurable-metrics
// feature is visible before anything is connected.
const { resolveRange, listDays } = require('./_dates');

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
    previous: { spend: Math.round(totalSpend * 0.97) },
    metrics,
    daily: { dates, spend: spendDaily }
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
    list.push({
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      spend,
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

module.exports = { demoDashboard, demoHistory, demoAds, DEMO_METRICS };
