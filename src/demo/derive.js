// Demo data derivation. The fixtures hold ONE canonical 90-day daily
// series per platform plus structure weights; every response the demo
// serves is derived from them here, so spend, impressions, clicks, CTR,
// CPC, CPM, conversions and cost-per reconcile arithmetically across every
// card, chart and nested table row. No number in this file - only in the
// fixtures.
import daily from './fixtures/daily.json';
import structure from './fixtures/structure.json';
import client from './fixtures/client.json';
import studio from './fixtures/studio.json';

const DATES = daily.dates;
const N = DATES.length;
const LAST = DATES[N - 1];
const r2 = (v) => Math.round(v * 100) / 100;

export { DEMO_MESSAGE } from './constants';

// ---- window resolution, anchored to the fixture's last date ----
function clampIdx(iso, fallback) {
  if (!iso) return fallback;
  let i = DATES.findIndex((d) => d >= iso);
  if (i === -1) i = N - 1;
  return i;
}

export function resolveWindow(q = {}) {
  let si;
  let ui = N - 1;
  if (q.since && q.until) {
    si = clampIdx(q.since, 0);
    ui = Math.max(si, DATES.findLastIndex((d) => d <= q.until));
  } else {
    const range = q.range || 'last_7d';
    if (range === 'today') si = N - 1;
    else if (range === 'last_30d') si = N - 30;
    else if (range === 'this_month') si = DATES.findIndex((d) => d.slice(0, 7) === LAST.slice(0, 7));
    else si = N - 7; // last_7d and anything unknown
  }
  si = Math.max(0, si);
  const len = ui - si + 1;
  const prevUi = Math.max(0, si - 1);
  const prevSi = Math.max(0, si - len);
  return {
    si,
    ui,
    len,
    dates: DATES.slice(si, ui + 1),
    prevSi,
    prevUi,
    prevDates: DATES.slice(prevSi, prevUi + 1),
    since: DATES[si],
    until: DATES[ui],
    prevSince: DATES[prevSi],
    prevUntil: DATES[prevUi],
    range: q.since ? 'custom' : q.range || 'last_7d'
  };
}

// effective campaign share on a given absolute day index (rampFrom
// campaigns hold no weight before their start; others absorb it)
function effShares(campaigns, dayIdx) {
  const raw = campaigns.map((c) => (c.rampFrom != null && dayIdx < c.rampFrom ? 0 : c.share));
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return raw.map((w) => w / total);
}

const sumRange = (rows, si, ui, f) => {
  let t = 0;
  for (let i = si; i <= ui; i++) t += f(rows[i]);
  return t;
};
const series = (rows, si, ui, f) => {
  const out = [];
  for (let i = si; i <= ui; i++) out.push(f(rows[i]));
  return out;
};

// per-campaign aggregate over a window, share-weighted per day
function campaignAgg(platform, campIdx, si, ui) {
  const rows = daily[platform];
  const camps = structure[platform];
  const agg = { spend: 0, impressions: 0, clicks: 0, reach: 0, video: 0, events: {} };
  for (let i = si; i <= ui; i++) {
    const share = effShares(camps, i)[campIdx];
    const d = rows[i];
    agg.spend += d.spend * share;
    agg.impressions += d.impressions * share;
    agg.clicks += d.clicks * share;
    agg.reach += (d.reach || 0) * share;
    agg.video += (d.video || 0) * share;
    for (const [ev, v] of Object.entries(d.events)) agg.events[ev] = (agg.events[ev] || 0) + v * share;
  }
  agg.spend = r2(agg.spend);
  agg.impressions = Math.round(agg.impressions);
  agg.clicks = Math.round(agg.clicks);
  agg.reach = Math.round(agg.reach);
  agg.video = Math.round(agg.video);
  for (const ev of Object.keys(agg.events)) agg.events[ev] = Math.round(agg.events[ev]);
  return agg;
}

const cfg = client.metricsConfig;
const primaryEvent = (platform) => cfg.primaryResult[platform] && cfg.primaryResult[platform].event;

// ---- get-report ----
export function buildReport(q) {
  const w = resolveWindow(q);
  const channel = (platform) => {
    const rows = daily[platform];
    const tot = (f) => sumRange(rows, w.si, w.ui, f);
    const prev = (f) => sumRange(rows, w.prevSi, w.prevUi, f);
    const events = cfg.conversions.filter((c) => c.platform === platform);
    const ch = {
      status: 'ok',
      totals: { spend: r2(tot((d) => d.spend)), impressions: tot((d) => d.impressions), clicks: tot((d) => d.clicks) },
      previous: { spend: r2(prev((d) => d.spend)), impressions: prev((d) => d.impressions), clicks: prev((d) => d.clicks) },
      daily: {
        spend: series(rows, w.si, w.ui, (d) => d.spend),
        impressions: series(rows, w.si, w.ui, (d) => d.impressions),
        clicks: series(rows, w.si, w.ui, (d) => d.clicks)
      },
      previousDaily: {
        spend: series(rows, w.prevSi, w.prevUi, (d) => d.spend),
        impressions: series(rows, w.prevSi, w.prevUi, (d) => d.impressions),
        clicks: series(rows, w.prevSi, w.prevUi, (d) => d.clicks)
      },
      metrics: events.map((m) => {
        const value = tot((d) => d.events[m.id] || 0);
        const previous = prev((d) => d.events[m.id] || 0);
        const spendNow = tot((d) => d.spend);
        const spendPrev = prev((d) => d.spend);
        return {
          id: m.id,
          label: m.label,
          targetCostPer: null,
          value,
          previous,
          costPer: value > 0 ? r2(spendNow / value) : null,
          prevCostPer: previous > 0 ? r2(spendPrev / previous) : null,
          daily: series(rows, w.si, w.ui, (d) => d.events[m.id] || 0),
          prevDaily: series(rows, w.prevSi, w.prevUi, (d) => d.events[m.id] || 0)
        };
      })
    };
    if (platform === 'meta') {
      ch.landingPageViews = { value: tot((d) => d.lpv), previous: prev((d) => d.lpv), daily: series(rows, w.si, w.ui, (d) => d.lpv) };
      ch.extras = {
        reach: { value: tot((d) => d.reach), previous: prev((d) => d.reach), daily: series(rows, w.si, w.ui, (d) => d.reach) },
        video_views: { value: tot((d) => d.video), previous: prev((d) => d.video), daily: series(rows, w.si, w.ui, (d) => d.video) },
        thruplays: { value: 0, previous: 0, daily: series(rows, w.si, w.ui, () => 0) },
        engagement: { value: tot((d) => d.engagement), previous: prev((d) => d.engagement), daily: series(rows, w.si, w.ui, (d) => d.engagement) }
      };
    }
    return ch;
  };

  const campaigns = [];
  for (const platform of ['meta', 'google']) {
    structure[platform].forEach((c, ci) => {
      const now = campaignAgg(platform, ci, w.si, w.ui);
      const before = campaignAgg(platform, ci, w.prevSi, w.prevUi);
      if (now.spend <= 0) return;
      const prim = primaryEvent(platform);
      campaigns.push({
        name: c.name,
        channel: platform,
        spend: now.spend,
        impressions: now.impressions,
        clicks: now.clicks,
        results: now.events[prim] ?? null,
        costPer: now.events[prim] > 0 ? r2(now.spend / now.events[prim]) : null,
        metricLabel: client.eventLabels[prim],
        events: now.events,
        previous: { spend: before.spend, impressions: before.impressions, clicks: before.clicks, results: before.events[prim] ?? null, events: before.events }
      });
    });
  }
  campaigns.sort((a, b) => b.spend - a.spend);

  return {
    isDemo: true,
    range: w.range,
    since: w.since,
    until: w.until,
    prevSince: w.prevSince,
    prevUntil: w.prevUntil,
    dates: w.dates,
    prevDates: w.prevDates,
    channels: { meta: channel('meta'), google: channel('google') },
    campaigns
  };
}

// ---- get-manage-tree: leaves derive from shares, parents SUM their
// children, so every nesting level reconciles exactly ----
export function buildManageTree(q, platform) {
  const w = resolveWindow(q);
  const prim = primaryEvent(platform);
  const nodeFrom = (agg, id, name, type, extra = {}) => {
    const conversions = agg.events[prim] ?? 0;
    return {
      id,
      type,
      name,
      status: extra.paused ? 'paused' : 'active',
      effectiveStatus: extra.paused ? 'PAUSED' : 'ACTIVE',
      budget: extra.budget || null,
      editableBudget: !!extra.budget,
      metrics: {
        spend: r2(agg.spend),
        impressions: agg.impressions,
        clicks: agg.clicks,
        reach: platform === 'meta' ? agg.reach : null,
        ctr: agg.impressions > 0 ? r2((agg.clicks / agg.impressions) * 100) : null,
        cpc: agg.clicks > 0 ? r2(agg.spend / agg.clicks) : null,
        conversions,
        cpa: conversions > 0 ? r2(agg.spend / conversions) : null,
        roas: null,
        events: { ...agg.events, video_view: agg.video || 0 }
      },
      children: extra.children || []
    };
  };
  const scale = (agg, share, isVideo) => {
    const out = {
      spend: r2(agg.spend * share),
      impressions: Math.round(agg.impressions * share),
      clicks: Math.round(agg.clicks * share),
      reach: Math.round((agg.reach || 0) * share),
      video: isVideo === undefined ? Math.round((agg.video || 0) * share) : isVideo ? Math.round((agg.video || 0) * share) : 0,
      events: {}
    };
    for (const [ev, v] of Object.entries(agg.events)) out.events[ev] = Math.round(v * share);
    return out;
  };
  const sumAggs = (aggs) => {
    const out = { spend: 0, impressions: 0, clicks: 0, reach: 0, video: 0, events: {} };
    for (const a of aggs) {
      out.spend = r2(out.spend + a.spend);
      out.impressions += a.impressions;
      out.clicks += a.clicks;
      out.reach += a.reach || 0;
      out.video += a.video || 0;
      for (const [ev, v] of Object.entries(a.events)) out.events[ev] = (out.events[ev] || 0) + v;
    }
    return out;
  };

  const campaigns = structure[platform].map((c, ci) => {
    const cAgg = campaignAgg(platform, ci, w.si, w.ui);
    const groups = c.children.map((g) => {
      const gBase = scale(cAgg, g.share);
      const ads = g.children.map((ad) => {
        const aAgg = scale(gBase, ad.share, ad.format === 'video');
        return nodeFrom(aAgg, ad.id, ad.name, 'ad', { paused: ad.id === 'mad4' });
      });
      const gAgg = sumAggs(ads.map((n) => ({ ...n.metrics, video: n.metrics.events.video_view, events: n.metrics.events })));
      return nodeFrom(gAgg, g.id, g.name, platform === 'meta' ? 'adset' : 'adgroup', { children: ads });
    });
    const cSum = sumAggs(groups.map((n) => ({ ...n.metrics, video: n.metrics.events.video_view, events: n.metrics.events })));
    const days = Math.max(1, w.len);
    return nodeFrom(cSum, c.id, c.name, 'campaign', {
      children: groups,
      budget: { type: 'daily', amount: r2(cSum.spend / days) }
    });
  });

  return {
    state: 'ok',
    channel: platform,
    range: w.range,
    since: w.since,
    until: w.until,
    accountId: client.accounts[platform].id,
    accountName: client.accounts[platform].name,
    canManage: true,
    guardrails: { pct: 50, ceiling: 1000 },
    primaryMetric: client.eventLabels[prim],
    campaigns
  };
}

// ---- get-heatmap: mapped events spread over hour-of-day weights ----
export function buildHeatmap(q) {
  const w = resolveWindow(q);
  const hw = client.heatProfile.hours;
  const hwSum = hw.reduce((a, b) => a + b, 0);
  const cells = Array.from({ length: 7 }, () => Array(24).fill(0));
  let total = 0;
  for (let i = w.si; i <= w.ui; i++) {
    const iso = DATES[i];
    const dow = (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const count = (daily.meta[i].events[primaryEvent('meta')] || 0) + (daily.google[i].events[primaryEvent('google')] || 0);
    for (let h = 0; h < 24; h++) {
      const v = (count * hw[h]) / hwSum;
      cells[dow][h] = r2(cells[dow][h] + v);
      total += v;
    }
  }
  return { range: w.range, since: w.since, until: w.until, platforms: ['meta', 'google'], total: r2(total), cells };
}

// ---- small statics ----
export const buildStatus = () => ({
  loggedIn: true,
  email: client.email,
  isPlatformAdmin: false,
  metaConnected: true,
  metaNeedsPick: false,
  metaAccountName: client.accounts.meta.name,
  googleConnected: true,
  googleNeedsPick: false,
  googleAccountName: client.accounts.google.name,
  metaPrimaryMetric: { id: primaryEvent('meta'), label: client.eventLabels[primaryEvent('meta')] },
  googlePrimaryMetric: { id: primaryEvent('google'), label: client.eventLabels[primaryEvent('google')] },
  hasPassword: true,
  aiPrefs: null
});

export const buildWorkspaces = () => ({
  active: { ...client.workspace, adminView: false },
  workspaces: [client.workspace]
});

export const buildMetricsConfig = () => ({ config: cfg });
export const buildAutomations = () => ({ modules: { messaging: true, email: false, winback: true, gmb: false } });
export const buildStudioConfig = () => studio.config;
export const buildStudioGallery = () => ({ assets: studio.assets });
export const buildAccounts = () => ({
  meta: { adAccounts: [{ id: client.accounts.meta.id, name: client.accounts.meta.name }], selectedAdAccountId: client.accounts.meta.id },
  google: { adAccounts: [{ id: client.accounts.google.id, name: client.accounts.google.name }], selectedAdAccountId: client.accounts.google.id }
});
export const buildChips = () => ({
  chips: [
    { key: 'today', color: 'c-green', label: 'How did my ads do today?' },
    { key: 'cpl', color: 'c-cobalt', label: 'What’s my cost per enquiry?' },
    { key: 'best', color: 'c-purple', label: 'Which campaign is doing best?' },
    { key: 'alert', color: 'c-amber', label: 'Warn me if something goes wrong' }
  ]
});

// Canned chat fallback (used when the live AI isn't reachable). Every
// figure is computed from the fixture window - nothing hardcoded.
export function chatFallback(chip) {
  const w = resolveWindow({ range: 'last_7d' });
  const rep = buildReport({ range: 'last_7d' });
  const mMsg = rep.channels.meta.metrics.find((m) => m.id === primaryEvent('meta'));
  const gCall = rep.channels.google.metrics.find((m) => m.id === primaryEvent('google'));
  const spend = r2(rep.channels.meta.totals.spend + rep.channels.google.totals.spend);
  const enq = (mMsg ? mMsg.value : 0) + (gCall ? gCall.value : 0);
  const cpe = enq > 0 ? r2(spend / enq) : null;
  const best = rep.campaigns.filter((c) => c.costPer != null).sort((a, b) => a.costPer - b.costPer)[0];
  void w;
  if (chip === 'today') {
    return `In the last week Northside Dental spent **S$${spend.toLocaleString()}** and received **${enq} enquiries** across Meta and Google — that's **S$${cpe} per enquiry** blended.`;
  }
  if (chip === 'cpl') {
    return `Blended, each enquiry costs **S$${cpe}** right now. On Meta an enquiry is a messaging conversation; on Google it's a call from an ad.`;
  }
  if (chip === 'best') {
    return best
      ? `**${best.name}** is the winner — **${best.results} ${'enquiries'}** at **S$${best.costPer}** each, the cheapest of any campaign this week.`
      : 'No campaign stands out in this window yet.';
  }
  if (chip === 'alert') {
    return 'In the full product I watch your numbers and warn you the moment something drifts — sign up and I’ll keep an eye on the real thing.';
  }
  return 'This demo answers the suggested questions below with sample data — sign up free and I’ll answer anything about your real campaigns.';
}

export { client as demoClient };
