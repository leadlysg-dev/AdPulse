// Deterministic demo data so the dashboard never looks broken before a
// customer connects an ad account. The numbers are generated from smooth
// waves (no randomness) so they stay stable between page loads.
const { resolveRange, listDays } = require('./_dates');

function demoDay(i) {
  return {
    leads: Math.round(4 + 2 * Math.sin(i / 3) + (i % 5) * 0.9),
    spend: Math.round(112 + 30 * Math.sin(i / 4 + 1) + (i % 7) * 6)
  };
}

function demoDashboard(range) {
  const { since, until, prevSince, prevUntil } = resolveRange(range);
  const dates = listDays(since, until);
  const leads = [];
  const spend = [];
  dates.forEach((_, i) => {
    const d = demoDay(i);
    leads.push(d.leads);
    spend.push(d.spend);
  });

  const totalLeads = leads.reduce((a, b) => a + b, 0);
  const totalSpend = spend.reduce((a, b) => a + b, 0);

  // Prior period runs a little worse, so the demo insights have a story to tell.
  const prevLeads = Math.round(totalLeads * 0.88);
  const prevSpend = Math.round(totalSpend * 0.97);

  return {
    isDemo: true,
    range,
    since,
    until,
    prevSince,
    prevUntil,
    leads: totalLeads,
    spend: totalSpend,
    costPerLead: totalLeads ? +(totalSpend / totalLeads).toFixed(2) : 0,
    metaSpend: Math.round(totalSpend * 0.63),
    googleSpend: Math.round(totalSpend * 0.37),
    previous: {
      leads: prevLeads,
      spend: prevSpend,
      costPerLead: prevLeads ? +(prevSpend / prevLeads).toFixed(2) : 0
    },
    daily: { dates, leads, spend }
  };
}

function demoHistory(weeks = 12) {
  const now = Date.now();
  const list = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now - i * 7 * 86400000);
    const start = new Date(end.getTime() - 6 * 86400000);
    const leads = Math.round(26 + 8 * Math.sin((weeks - i) / 2) + (weeks - i) * 0.8);
    const spend = Math.round(760 + 90 * Math.sin((weeks - i) / 2.5) + (weeks - i) * 14);
    list.push({
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      leads,
      spend,
      costPerLead: +(spend / leads).toFixed(2)
    });
  }
  return { isDemo: true, weeks: list };
}

function demoAds(range) {
  return {
    isDemo: true,
    range,
    ads: [
      {
        id: 'demo-1',
        name: 'Spring offer — lead form',
        headline: 'Book your free consultation',
        body: 'Limited slots this month. Tell us what you need and we’ll call you back the same day.',
        thumbnailUrl: null,
        spend: 1240,
        leads: 52,
        costPerLead: 23.85
      },
      {
        id: 'demo-2',
        name: 'Testimonial video — retargeting',
        headline: '"They doubled our enquiries in 6 weeks"',
        body: 'Hear how local businesses grew with us. Watch the 30-second story.',
        thumbnailUrl: null,
        spend: 860,
        leads: 31,
        costPerLead: 27.74
      },
      {
        id: 'demo-3',
        name: 'Evergreen brand — broad reach',
        headline: 'The easier way to get more customers',
        body: 'No contracts, cancel anytime. See plans and pricing.',
        thumbnailUrl: null,
        spend: 410,
        leads: 9,
        costPerLead: 45.56
      }
    ]
  };
}

module.exports = { demoDashboard, demoHistory, demoAds };
