// The tracked-metrics vocabulary: plain-English options first, the
// technical set behind "More metrics", plus dynamic custom events
// (ids "event:<metric_id>") discovered from the workspace's connected
// pixel / conversion actions. Metrics with no connected data source render
// a quiet "connect to track" state - never a zero.
export const PLAIN_METRICS = [
  { id: 'spend', label: 'Money spent' },
  { id: 'enquiries', label: 'New enquiries' },
  { id: 'cpe', label: 'Cost per enquiry' },
  { id: 'messaging', label: 'Messaging conversations' },
  { id: 'booked_calls', label: 'Booked calls' },
  { id: 'reach', label: 'People reached' },
  { id: 'clicks', label: 'Clicks' }
];

export const TECH_METRICS = [
  { id: 'ctr', label: 'CTR' },
  { id: 'cpc', label: 'CPC' },
  { id: 'conv_rate', label: 'Conversion rate' },
  { id: 'roas', label: 'ROAS' },
  { id: 'frequency', label: 'Frequency' }
];

export const DEFAULT_TRACKED = ['spend', 'enquiries', 'cpe', 'clicks'];

export const labelFor = (id, customLabels = {}) => {
  const all = [...PLAIN_METRICS, ...TECH_METRICS].find((m) => m.id === id);
  if (all) return all.label;
  if (id.startsWith('event:')) return customLabels[id] || id.slice(6);
  return id;
};

const sgd = (v) =>
  'S$' + (v || 0).toLocaleString('en-SG', { maximumFractionDigits: v >= 100 ? 0 : 2 });

// Find a provider-metric (from get-report channel.metrics) whose id or label
// matches a tracked concept - e.g. "messaging" matches Meta's
// onsite_conversion.messaging_conversation_started_7d.
function findEvent(channels, matcher) {
  for (const ch of channels) {
    for (const m of ch.metrics || []) {
      if (matcher(String(m.id || '').toLowerCase(), String(m.label || '').toLowerCase())) return { ch, m };
    }
  }
  return null;
}

function sumEvent(channels, matcher) {
  let found = false;
  let value = 0;
  let previous = 0;
  const daily = [];
  for (const ch of channels) {
    for (const m of ch.metrics || []) {
      if (matcher(String(m.id || '').toLowerCase(), String(m.label || '').toLowerCase())) {
        found = true;
        value += m.value || 0;
        previous += m.previous || 0;
        (m.daily || []).forEach((v, i) => (daily[i] = (daily[i] || 0) + v));
      }
    }
  }
  return found ? { value, previous, daily } : null;
}

// One KPI per tracked metric, computed only from real report data. Returns
// { id, label, value, pct, goodUp, spark, unavailable }.
export function computeKpis(tracked, channels, nDays, customLabels = {}) {
  const sum = (key) => channels.reduce((a, c) => a + (c.totals?.[key] || 0), 0);
  const sumPrev = (key) => channels.reduce((a, c) => a + (c.previous?.[key] || 0), 0);
  const daily = (key) =>
    Array.from({ length: nDays }, (_, i) => channels.reduce((a, c) => a + ((c.daily?.[key] || [])[i] || 0), 0));
  const primary = sumEvent(channels, (id, label, i) => true) && {
    value: channels.reduce((a, c) => a + (c.metrics?.[0]?.value || 0), 0),
    previous: channels.reduce((a, c) => a + (c.metrics?.[0]?.previous || 0), 0),
    daily: channels.reduce((acc, c) => {
      (c.metrics?.[0]?.daily || []).forEach((v, i) => (acc[i] = (acc[i] || 0) + v));
      return acc;
    }, Array(nDays).fill(0))
  };
  const pct = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
  const ratio = (a, b) => (b > 0 ? a / b : null);

  return tracked.map((id) => {
    const base = { id, label: labelFor(id, customLabels) };
    const spend = sum('spend');
    const spendPrev = sumPrev('spend');
    const clicks = sum('clicks');
    const impressions = sum('impressions');
    switch (id) {
      case 'spend':
        return { ...base, value: sgd(spend), pct: pct(spend, spendPrev), goodUp: null, spark: daily('spend') };
      case 'clicks':
        return { ...base, value: clicks.toLocaleString(), pct: pct(clicks, sumPrev('clicks')), goodUp: true, spark: daily('clicks') };
      case 'enquiries': {
        if (!primary || !channels.some((c) => (c.metrics || []).length)) return { ...base, unavailable: true };
        return { ...base, value: String(Math.round(primary.value)), pct: pct(primary.value, primary.previous), goodUp: true, spark: primary.daily };
      }
      case 'cpe': {
        if (!primary || primary.value <= 0) return { ...base, unavailable: !primary };
        const cur = ratio(spend, primary.value);
        const prev = ratio(spendPrev, primary.previous);
        return {
          ...base,
          value: cur === null ? '—' : sgd(cur),
          pct: cur !== null && prev !== null ? pct(cur, prev) : null,
          goodUp: false,
          spark: daily('spend').map((s, i) => (primary.daily[i] > 0 ? s / primary.daily[i] : 0))
        };
      }
      case 'ctr': {
        const cur = ratio(clicks, impressions);
        const prev = ratio(sumPrev('clicks'), sumPrev('impressions'));
        if (cur === null) return { ...base, unavailable: true };
        return { ...base, value: (cur * 100).toFixed(2) + '%', pct: prev ? pct(cur, prev) : null, goodUp: true, spark: daily('clicks') };
      }
      case 'cpc': {
        const cur = ratio(spend, clicks);
        if (cur === null) return { ...base, unavailable: true };
        const prev = ratio(spendPrev, sumPrev('clicks'));
        return { ...base, value: sgd(cur), pct: prev ? pct(cur, prev) : null, goodUp: false, spark: daily('spend') };
      }
      case 'conv_rate': {
        if (!primary || clicks <= 0) return { ...base, unavailable: true };
        const cur = primary.value / clicks;
        const prevClicks = sumPrev('clicks');
        const prev = prevClicks > 0 ? primary.previous / prevClicks : null;
        return { ...base, value: (cur * 100).toFixed(1) + '%', pct: prev ? pct(cur, prev) : null, goodUp: true, spark: primary.daily };
      }
      case 'messaging': {
        const hit = sumEvent(channels, (mid, mlabel) => mid.includes('messaging') || mlabel.includes('messag'));
        if (!hit) return { ...base, unavailable: true };
        return { ...base, value: String(Math.round(hit.value)), pct: pct(hit.value, hit.previous), goodUp: true, spark: hit.daily };
      }
      case 'booked_calls': {
        const hit = sumEvent(channels, (mid, mlabel) => mid.includes('schedule') || mlabel.includes('book') || mlabel.includes('call'));
        if (!hit) return { ...base, unavailable: true };
        return { ...base, value: String(Math.round(hit.value)), pct: pct(hit.value, hit.previous), goodUp: true, spark: hit.daily };
      }
      // reach / roas / frequency need data sources the report doesn't carry
      // yet - quiet connect-to-track state, never a fabricated zero.
      case 'reach':
      case 'roas':
      case 'frequency':
        return { ...base, unavailable: true };
      default: {
        if (id.startsWith('event:')) {
          const want = id.slice(6).toLowerCase();
          const hit = sumEvent(channels, (mid) => mid === want);
          if (!hit) return { ...base, unavailable: true };
          return { ...base, value: String(Math.round(hit.value)), pct: pct(hit.value, hit.previous), goodUp: true, spark: hit.daily };
        }
        return { ...base, unavailable: true };
      }
    }
  });
}
