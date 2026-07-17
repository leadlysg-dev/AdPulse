// The master metrics engine. One workspace-level config (set during
// onboarding, re-run only from Settings) drives every KPI card and every
// table column in the app:
//   defaults  - Spend, CPM, Impressions, Ad clicks, CTR, CPC. Always on.
//   extras    - optional non-conversion metrics (Reach, Frequency, ...).
//   conversions - real platform events; each brings its Cost per with it.
//   primaryResult - ONE mapped event per platform, blended into a single
//     headline number ("Enquiries") with a per-platform composition.
//
// Blending rules: delivery metrics (spend, impressions, clicks, CPM, CPC,
// CTR) are the same unit everywhere and blend freely. Conversions never
// blend across platforms UNLESS the config maps them as the same primary
// result - then the blend is the sum of the mapped events and the cost per
// is blended spend / total results. result_source: 'platform_event' today,
// 'crm_verified' later - same shape, zero UI change.

export const DEFAULT_METRIC_IDS = ['spend', 'cpm', 'impressions', 'clicks', 'ctr', 'cpc'];

export const DEFAULT_LABELS = {
  spend: 'Spend',
  cpm: 'CPM',
  impressions: 'Impressions',
  clicks: 'Ad clicks',
  ctr: 'CTR',
  cpc: 'CPC'
};

export const EXTRA_LABELS = {
  reach: 'Reach',
  frequency: 'Frequency',
  video_views: 'Video views',
  thruplays: 'ThruPlays',
  engagement: 'Engagement'
};

export const sgd = (v) =>
  'S$' + (v || 0).toLocaleString('en-SG', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });
export const fmtInt = (v) => (v == null ? '—' : Math.round(v).toLocaleString());
const round1 = (v) => Math.round(v * 10) / 10;

// "Enquiries" -> "enquiry", "Leads" -> "lead" - good enough for card labels.
export function singular(label) {
  const s = String(label || 'result').trim();
  if (/ies$/i.test(s)) return s.replace(/ies$/i, 'y').toLowerCase();
  if (/ses$/i.test(s)) return s.replace(/es$/i, '').toLowerCase();
  if (/s$/i.test(s) && s.length > 3) return s.replace(/s$/i, '').toLowerCase();
  return s.toLowerCase();
}

const pct = (cur, prev) => (prev > 0 && cur != null ? ((cur - prev) / prev) * 100 : null);
const ratio = (a, b) => (b > 0 ? a / b : null);

const sumT = (channels, key) => channels.reduce((a, c) => a + (c.totals?.[key] || 0), 0);
const sumP = (channels, key) => channels.reduce((a, c) => a + (c.previous?.[key] || 0), 0);
export const dailyOf = (channels, key, n) =>
  Array.from({ length: n }, (_, i) => channels.reduce((a, c) => a + ((c.daily?.[key] || [])[i] || 0), 0));
export const prevDailyOf = (channels, key, n) =>
  Array.from({ length: n }, (_, i) => channels.reduce((a, c) => a + ((c.previousDaily?.[key] || [])[i] || 0), 0));

// The channels a platform filter leaves visible, tagged with their platform.
export function visibleChannels(report, platform = 'all') {
  const out = [];
  for (const p of ['meta', 'google']) {
    if (platform !== 'all' && platform !== p) continue;
    const ch = report?.channels?.[p];
    if (ch && ch.status === 'ok') out.push({ ...ch, platform: p });
  }
  return out;
}

// ---- The blended primary result --------------------------------------

// One part per platform whose mapped event is present in the visible
// channels; the blend is their sum, cost per is blended spend / total.
export function blendedPrimary(config, report, platform = 'all') {
  const pr = config?.primaryResult;
  if (!pr || !report) return null;
  const n = (report.dates || []).length;
  const pn = (report.prevDates || []).length || n;
  const parts = [];
  const visible = [];
  for (const p of ['meta', 'google']) {
    if (platform !== 'all' && platform !== p) continue;
    const ch = report.channels?.[p];
    if (!ch || ch.status !== 'ok') continue;
    visible.push(ch);
    const map = pr[p];
    if (!map) continue;
    const m = (ch.metrics || []).find((x) => x.id === map.event);
    if (!m) continue;
    parts.push({
      platform: p,
      event: map.event,
      label: m.label || map.label || map.event,
      value: m.value || 0,
      previous: m.previous || 0,
      daily: m.daily || [],
      prevDaily: m.prevDaily || [],
      spend: ch.totals?.spend || 0,
      prevSpend: ch.previous?.spend || 0,
      costPer: m.costPer,
      prevCostPer: m.prevCostPer
    });
  }
  if (!parts.length) return null;
  const value = round1(parts.reduce((a, x) => a + x.value, 0));
  const previous = round1(parts.reduce((a, x) => a + x.previous, 0));
  const spend = visible.reduce((a, c) => a + (c.totals?.spend || 0), 0);
  const prevSpend = visible.reduce((a, c) => a + (c.previous?.spend || 0), 0);
  const daily = Array.from({ length: n }, (_, i) => parts.reduce((a, x) => a + (x.daily[i] || 0), 0));
  const prevDaily = Array.from({ length: pn }, (_, i) => parts.reduce((a, x) => a + (x.prevDaily[i] || 0), 0));
  return {
    name: pr.name || 'Enquiries',
    source: pr.source || 'platform_event',
    value,
    previous,
    daily,
    prevDaily,
    spend,
    prevSpend,
    costPer: ratio(spend, value),
    prevCostPer: ratio(prevSpend, previous),
    parts
  };
}

// ---- Columns ----------------------------------------------------------

// The one list every table follows, at every nesting level: defaults, the
// blended result pair, extras, then each chosen conversion + its Cost per.
// Conversions matching the primary mapping are covered by the result pair.
export function masterColumns(config) {
  const cols = DEFAULT_METRIC_IDS.map((id) => ({ id, label: DEFAULT_LABELS[id], type: 'default' }));
  const pr = config?.primaryResult;
  if (pr) {
    cols.push({ id: 'primary', label: pr.name || 'Enquiries', type: 'primary' });
    cols.push({ id: 'primary_costper', label: `Cost per ${singular(pr.name)}`, type: 'primary_costper' });
  }
  for (const ex of config?.extras || []) {
    cols.push({ id: `x_${ex}`, xid: ex, label: EXTRA_LABELS[ex] || ex, type: 'extra' });
  }
  const isPrimary = (cv) => pr && pr[cv.platform] && pr[cv.platform].event === cv.id;
  for (const cv of config?.conversions || []) {
    if (isPrimary(cv)) continue;
    cols.push({ id: `c_${cv.platform}_${cv.id}`, event: cv.id, platform: cv.platform, label: cv.label, type: 'conv' });
    cols.push({
      id: `cp_${cv.platform}_${cv.id}`,
      event: cv.id,
      platform: cv.platform,
      label: `Cost per ${singular(cv.label)}`,
      type: 'costper'
    });
  }
  return cols;
}

// Raw (sortable) value of one master column for a campaign summary row from
// get-report. `prev` reads the matched previous-period aggregate instead.
export function campaignValue(col, c, prev = false) {
  const src = prev ? c.previous : c;
  if (!src) return null;
  const events = src.events || {};
  switch (col.type) {
    case 'default': {
      const spend = src.spend || 0;
      const imps = src.impressions || 0;
      const clicks = src.clicks || 0;
      if (col.id === 'spend') return spend;
      if (col.id === 'cpm') return ratio(spend * 1000, imps);
      if (col.id === 'impressions') return imps;
      if (col.id === 'clicks') return clicks;
      if (col.id === 'ctr') return imps > 0 ? (clicks / imps) * 100 : null;
      if (col.id === 'cpc') return ratio(spend, clicks);
      return null;
    }
    case 'primary':
      return src.results ?? null;
    case 'primary_costper':
      return src.results > 0 ? (src.spend || 0) / src.results : null;
    case 'extra':
      return null; // extras are account-level series, not per-campaign
    case 'conv':
      return c.channel === col.platform ? (events[col.event] ?? 0) : null;
    case 'costper': {
      if (c.channel !== col.platform) return null;
      const v = events[col.event];
      return v > 0 ? (src.spend || 0) / v : null;
    }
    default:
      return null;
  }
}

// Raw value of one master column for an Ad Manager tree node (any level).
export function nodeValue(col, node, channel) {
  const m = node.metrics || {};
  const events = m.events || {};
  switch (col.type) {
    case 'default': {
      if (col.id === 'spend') return m.spend || 0;
      if (col.id === 'cpm') return ratio((m.spend || 0) * 1000, m.impressions || 0);
      if (col.id === 'impressions') return m.impressions || 0;
      if (col.id === 'clicks') return m.clicks || 0;
      if (col.id === 'ctr') return m.ctr ?? null;
      if (col.id === 'cpc') return m.cpc ?? null;
      return null;
    }
    case 'primary':
      return m.conversions ?? null;
    case 'primary_costper':
      return m.cpa ?? null;
    case 'extra': {
      if (channel !== 'meta') return null;
      if (col.xid === 'reach') return m.reach ?? null;
      if (col.xid === 'frequency') return m.reach > 0 ? (m.impressions || 0) / m.reach : null;
      if (col.xid === 'video_views') return events.video_view ?? null;
      if (col.xid === 'thruplays') return events.video_thruplay_watched ?? null;
      if (col.xid === 'engagement') return events.post_engagement ?? null;
      return null;
    }
    case 'conv':
      return channel === col.platform ? (events[col.event] ?? 0) : null;
    case 'costper': {
      if (channel !== col.platform) return null;
      const v = events[col.event];
      return v > 0 ? (m.spend || 0) / v : null;
    }
    default:
      return null;
  }
}

// Display formatting shared by both tables.
export function formatCol(col, v) {
  if (v == null || !isFinite(v)) return '—';
  switch (col.type) {
    case 'default':
      if (col.id === 'spend' || col.id === 'cpc' || col.id === 'cpm') return sgd(v);
      if (col.id === 'ctr') return v.toFixed(2) + '%';
      return fmtInt(v);
    case 'primary':
    case 'conv':
      return v % 1 ? v.toFixed(1) : fmtInt(v);
    case 'primary_costper':
    case 'costper':
      return sgd(v);
    case 'extra':
      if (col.xid === 'frequency') return v.toFixed(1) + '×';
      return fmtInt(v);
    default:
      return String(v);
  }
}

// Cost-per style columns read better going down.
export const goodUpFor = (col) =>
  col.type === 'costper' || col.type === 'primary_costper' || (col.type === 'default' && (col.id === 'cpc' || col.id === 'cpm'))
    ? false
    : col.type === 'default' && col.id === 'spend'
      ? null
      : true;

// ---- KPI cards ---------------------------------------------------------

// The Pulse tab's card list: the blended result pair first (the headline),
// then defaults, extras, then each other conversion + its Cost per.
// Every card: { id, label, value, pct, goodUp, spark, unavailable?, quiet? }
export function masterKpis(config, report, platform = 'all') {
  if (!report) return [];
  const n = (report.dates || []).length;
  const channels = [];
  for (const p of ['meta', 'google']) {
    if (platform !== 'all' && platform !== p) continue;
    const ch = report.channels?.[p];
    if (ch && ch.status === 'ok') channels.push({ ...ch, platform: p });
  }
  const cards = [];

  const spendDaily = dailyOf(channels, 'spend', n);
  const primary = blendedPrimary(config, report, platform);
  if (primary) {
    cards.push({
      id: 'primary',
      label: primary.name,
      value: primary.value % 1 ? primary.value.toFixed(1) : fmtInt(primary.value),
      pct: pct(primary.value, primary.previous),
      goodUp: true,
      spark: primary.daily,
      primary
    });
    cards.push({
      id: 'primary_costper',
      label: `Cost per ${singular(primary.name)}`,
      value: primary.costPer == null ? '—' : sgd(primary.costPer),
      pct: primary.costPer != null && primary.prevCostPer != null ? pct(primary.costPer, primary.prevCostPer) : null,
      goodUp: false,
      spark: primary.daily.map((v, i) => (v > 0 ? spendDaily[i] / v : 0))
    });
  } else if (config?.primaryResult) {
    cards.push({
      id: 'primary',
      label: config.primaryResult.name || 'Enquiries',
      unavailable: true,
      quiet: 'No mapped result on this view yet'
    });
  }

  const spend = sumT(channels, 'spend');
  const spendPrev = sumP(channels, 'spend');
  const imps = sumT(channels, 'impressions');
  const impsPrev = sumP(channels, 'impressions');
  const clicks = sumT(channels, 'clicks');
  const clicksPrev = sumP(channels, 'clicks');

  cards.push({ id: 'spend', label: DEFAULT_LABELS.spend, value: sgd(spend), pct: pct(spend, spendPrev), goodUp: null, spark: dailyOf(channels, 'spend', n) });
  const cpm = ratio(spend * 1000, imps);
  const cpmPrev = ratio(spendPrev * 1000, impsPrev);
  cards.push({ id: 'cpm', label: DEFAULT_LABELS.cpm, value: cpm == null ? '—' : sgd(cpm), pct: cpm != null && cpmPrev != null ? pct(cpm, cpmPrev) : null, goodUp: false, spark: dailyOf(channels, 'impressions', n) });
  cards.push({ id: 'impressions', label: DEFAULT_LABELS.impressions, value: fmtInt(imps), pct: pct(imps, impsPrev), goodUp: true, spark: dailyOf(channels, 'impressions', n) });
  cards.push({ id: 'clicks', label: DEFAULT_LABELS.clicks, value: fmtInt(clicks), pct: pct(clicks, clicksPrev), goodUp: true, spark: dailyOf(channels, 'clicks', n) });
  const ctr = imps > 0 ? (clicks / imps) * 100 : null;
  const ctrPrev = impsPrev > 0 ? (clicksPrev / impsPrev) * 100 : null;
  cards.push({ id: 'ctr', label: DEFAULT_LABELS.ctr, value: ctr == null ? '—' : ctr.toFixed(2) + '%', pct: ctr != null && ctrPrev != null ? pct(ctr, ctrPrev) : null, goodUp: true, spark: dailyOf(channels, 'clicks', n) });
  const cpc = ratio(spend, clicks);
  const cpcPrev = ratio(spendPrev, clicksPrev);
  cards.push({ id: 'cpc', label: DEFAULT_LABELS.cpc, value: cpc == null ? '—' : sgd(cpc), pct: cpc != null && cpcPrev != null ? pct(cpc, cpcPrev) : null, goodUp: false, spark: dailyOf(channels, 'spend', n) });

  // Extras live on the Meta connection today; a view without Meta (or one
  // that never recorded the metric) renders the quiet state, never a zero.
  const metaCh = channels.find((c) => c.platform === 'meta');
  for (const ex of config?.extras || []) {
    const label = EXTRA_LABELS[ex] || ex;
    const slot = metaCh?.extras?.[ex === 'frequency' ? 'reach' : ex];
    if (!metaCh || !slot || (ex !== 'frequency' && slot.value <= 0 && slot.previous <= 0)) {
      cards.push({ id: `x_${ex}`, label, unavailable: true });
      continue;
    }
    if (ex === 'frequency') {
      const f = slot.value > 0 ? (metaCh.totals?.impressions || 0) / slot.value : null;
      const fPrev = slot.previous > 0 ? (metaCh.previous?.impressions || 0) / slot.previous : null;
      if (f == null) {
        cards.push({ id: 'x_frequency', label, unavailable: true });
      } else {
        cards.push({ id: 'x_frequency', label, value: f.toFixed(1) + '×', pct: fPrev != null ? pct(f, fPrev) : null, goodUp: null, spark: slot.daily });
      }
      continue;
    }
    cards.push({ id: `x_${ex}`, label, value: fmtInt(slot.value), pct: pct(slot.value, slot.previous), goodUp: true, spark: slot.daily });
  }

  // Each chosen conversion (other than the primary mapping) + its Cost per.
  const pr = config?.primaryResult;
  for (const cv of config?.conversions || []) {
    if (pr && pr[cv.platform] && pr[cv.platform].event === cv.id) continue;
    if (platform !== 'all' && platform !== cv.platform) continue;
    const ch = channels.find((c) => c.platform === cv.platform);
    const m = ch && (ch.metrics || []).find((x) => x.id === cv.id);
    if (!m) {
      cards.push({ id: `c_${cv.platform}_${cv.id}`, label: cv.label, unavailable: true });
      continue;
    }
    cards.push({
      id: `c_${cv.platform}_${cv.id}`,
      label: cv.label,
      value: m.value % 1 ? m.value.toFixed(1) : fmtInt(m.value),
      pct: pct(m.value, m.previous),
      goodUp: true,
      spark: m.daily,
      platform: cv.platform
    });
    cards.push({
      id: `cp_${cv.platform}_${cv.id}`,
      label: `Cost per ${singular(cv.label)}`,
      value: m.costPer == null ? '—' : sgd(m.costPer),
      pct: m.costPer != null && m.prevCostPer != null ? pct(m.costPer, m.prevCostPer) : null,
      goodUp: false,
      spark: m.daily,
      platform: cv.platform
    });
  }

  return cards;
}
