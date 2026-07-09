// The condensed cross-platform performance snapshot Claude sees - used by
// both the AI insights card and the chat assistant. Never raw rows: period
// totals, per-metric counts/cost-pers, and top/bottom ads only. Meta is
// required (the app's primary platform); Google Ads and Search Console
// sections are included when connected and silently omitted when their
// fetch fails, so one platform's trouble never blocks the summary.
const { resolveRange } = require('./_dates');
const { metaGet, readRow, sumRows, costPer } = require('./_meta');
const { getSelectedMetrics } = require('./_metrics');
const { fetchGoogleCampaignDaily, fetchGoogleConversionsDaily } = require('./_googleAds');
const { scQuery } = require('./_google');

const PERFORMER_COUNT = 3;

async function metaSection(meta, since, until, prevSince, prevUntil) {
  const selectedMetrics = getSelectedMetrics(meta);
  const metricIds = selectedMetrics.map((m) => m.id);
  const [rows, prevRows, adRows] = await Promise.all([
    metaGet(`${meta.selectedAdAccountId}/insights`, {
      fields: 'spend,actions,impressions,clicks',
      time_range: JSON.stringify({ since, until }),
      access_token: meta.accessToken
    }),
    metaGet(`${meta.selectedAdAccountId}/insights`, {
      fields: 'spend,actions,impressions,clicks',
      time_range: JSON.stringify({ since: prevSince, until: prevUntil }),
      access_token: meta.accessToken
    }),
    metaGet(`${meta.selectedAdAccountId}/insights`, {
      fields: 'ad_name,spend,actions',
      level: 'ad',
      time_range: JSON.stringify({ since, until }),
      limit: 100,
      access_token: meta.accessToken
    })
  ]);

  const totals = sumRows(rows, metricIds);
  const prev = sumRows(prevRows, metricIds);
  const period = (t) => ({
    spend: +t.spend.toFixed(2),
    impressions: t.impressions,
    clicks: t.clicks,
    ctrPct: t.impressions > 0 ? +((t.clicks / t.impressions) * 100).toFixed(2) : null,
    results: selectedMetrics.map((m) => ({
      metric: m.label,
      count: t.values[m.id],
      costPerResult: costPer(t.spend, t.values[m.id]) || null
    }))
  });

  const primary = selectedMetrics[0];
  const ranked = adRows
    .map((row) => {
      const r = readRow(row, metricIds);
      return { name: row.ad_name, spend: +r.spend.toFixed(2), results: r.values[primary.id] };
    })
    .filter((a) => a.spend > 0)
    .map((a) => ({ ...a, costPerResult: a.results > 0 ? +(a.spend / a.results).toFixed(2) : null }));
  const withResults = ranked.filter((a) => a.costPerResult !== null);
  const topAds = withResults.sort((a, b) => a.costPerResult - b.costPerResult).slice(0, PERFORMER_COUNT);
  const bottomAds = ranked
    .filter((a) => !topAds.includes(a))
    .sort((a, b) => (b.costPerResult ?? Infinity) - (a.costPerResult ?? Infinity) || b.spend - a.spend)
    .slice(0, PERFORMER_COUNT);

  return {
    currentPeriod: period(totals),
    previousPeriod: period(prev),
    goals: selectedMetrics
      .filter((m) => m.targetCostPer != null)
      .map((m) => ({ metric: m.label, targetCostPerResult: m.targetCostPer })),
    topAdsByCostPerResult: topAds,
    worstAdsByCostPerResult: bottomAds
  };
}

async function googleSection(google, since, until, prevSince, prevUntil) {
  const metrics = google.selectedMetrics || [];
  const account = (google.adAccounts || []).find((a) => a.id === google.selectedAdAccountId);
  const opts = { loginCustomerId: account && account.loginCustomerId };
  const actionIds = metrics.map((m) => m.id);
  const [cur, prev, convCur, convPrev] = await Promise.all([
    fetchGoogleCampaignDaily(google, google.selectedAdAccountId, since, until, opts),
    fetchGoogleCampaignDaily(google, google.selectedAdAccountId, prevSince, prevUntil, opts),
    fetchGoogleConversionsDaily(google, google.selectedAdAccountId, since, until, actionIds, opts),
    fetchGoogleConversionsDaily(google, google.selectedAdAccountId, prevSince, prevUntil, actionIds, opts)
  ]);
  const totalize = (rows) =>
    rows.reduce(
      (t, r) => ({
        spend: t.spend + r.spend,
        impressions: t.impressions + r.impressions,
        clicks: t.clicks + r.clicks
      }),
      { spend: 0, impressions: 0, clicks: 0 }
    );
  const actionTotals = (rows) => {
    const by = {};
    rows.forEach((r) => {
      by[r.action] = (by[r.action] || 0) + r.conversions;
    });
    return by;
  };
  const period = (delivery, conv) => ({
    spend: +delivery.spend.toFixed(2),
    impressions: delivery.impressions,
    clicks: delivery.clicks,
    results: metrics.map((m) => {
      const count = +(conv[m.id] || 0).toFixed(1);
      return { metric: m.label, count, costPerResult: costPer(delivery.spend, count) || null };
    })
  });
  return {
    currentPeriod: period(totalize(cur.rows), actionTotals(convCur.rows)),
    previousPeriod: period(totalize(prev.rows), actionTotals(convPrev.rows))
  };
}

async function seoSection(google, since, until) {
  const res = await scQuery(google, google.selectedScSiteUrl, {
    startDate: since,
    endDate: until,
    dimensions: [],
    rowLimit: 1
  });
  if (res.status !== 200) return null;
  const row = (res.json.rows || [])[0] || {};
  return {
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    avgPosition: row.position != null ? +row.position.toFixed(1) : null
  };
}

// The full snapshot. Sections beyond Meta are best-effort.
async function buildSnapshot(user, range) {
  const meta = user.accounts.meta;
  const google = user.accounts.google;
  const { since, until, prevSince, prevUntil } = resolveRange(range);

  const summary = { range, currentPeriodDates: { since, until }, previousPeriodDates: { since: prevSince, until: prevUntil } };
  summary.metaAds = await metaSection(meta, since, until, prevSince, prevUntil);

  if (google && google.selectedAdAccountId && (google.selectedMetrics || []).length) {
    try {
      summary.googleAds = await googleSection(google, since, until, prevSince, prevUntil);
    } catch (err) {
      console.error(`[aiData] Google Ads section skipped: ${err.message}`);
    }
  }
  if (google && google.selectedScSiteUrl) {
    try {
      const seo = await seoSection(google, since, until);
      if (seo) summary.googleSearchOrganic = seo;
    } catch (err) {
      console.error(`[aiData] Search Console section skipped: ${err.message}`);
    }
  }
  return summary;
}

module.exports = { buildSnapshot };
