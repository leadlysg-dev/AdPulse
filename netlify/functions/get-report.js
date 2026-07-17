// Report data for the Pulse tab, scoped per platform. Each connected
// platform reports its OWN selected conversion metrics (selected_metrics
// rows on its connection, kept in sync with the workspace's master metrics
// config) - Meta metrics are action types read from the insights actions
// array, Google metrics are conversion-action resource names read via
// segments.conversion_action. The two are never merged into one number
// here: the frontend blends only what the master config maps as the same
// result, and explains the split.
//
// Delivery numbers (spend / impressions / clicks) are the same unit on
// both platforms, so the frontend may blend those freely.
const { getEmailFromRequest, getUser, saveUser } = require('./_store');
const { VALID_RANGES, resolveRange, resolveCustomRange, listDays } = require('./_dates');
const { metaGet, readRow, sumRows } = require('./_meta');
const { getSelectedMetrics, extractValues } = require('./_metrics');
const { fetchGoogleCampaignDaily, fetchGoogleConversionsDaily } = require('./_googleAds');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const round2 = (v) => +v.toFixed(2);
const costPer = (spend, count) => (count > 0 ? round2(spend / count) : null);

// Meta extras the master config can switch on. Reach is an insights field
// (not summable across days - totals come from the aggregate row); the rest
// are action types.
const EXTRA_ACTIONS = { video_views: 'video_view', thruplays: 'video_thruplay_watched', engagement: 'post_engagement' };

// One platform's slice of the response.
const emptyChannel = (status) => ({
  status, // ok | not-connected | no-account | no-metrics | error
  metrics: [],
  totals: { spend: 0, impressions: 0, clicks: 0 },
  previous: { spend: 0, impressions: 0, clicks: 0 },
  daily: { spend: [], impressions: [], clicks: [] },
  previousDaily: { spend: [], impressions: [], clicks: [] }
});

function metricEntry(m, spendNow, spendPrev, valueNow, valuePrev, daily, prevDaily) {
  return {
    id: m.id,
    label: m.label,
    targetCostPer: m.targetCostPer != null ? m.targetCostPer : null,
    value: valueNow,
    previous: valuePrev,
    costPer: costPer(spendNow, valueNow),
    prevCostPer: costPer(spendPrev, valuePrev),
    daily,
    prevDaily: prevDaily || []
  };
}

// Deterministic sample so the tab reads correctly before anything connects.
function demoReport(window, dates) {
  const wave = (i, base, amp, f) => Math.max(0, Math.round(base + amp * Math.sin(i / f)));
  const spend = dates.map((_, i) => wave(i, 58, 15, 4));
  const impressions = spend.map((s) => s * 41);
  const clicks = spend.map((s) => Math.round(s * 0.45));
  const leadsDaily = dates.map((_, i) => wave(i, 3, 2, 3));
  const total = (a) => a.reduce((x, y) => x + y, 0);
  const meta = {
    status: 'ok',
    totals: { spend: total(spend), impressions: total(impressions), clicks: total(clicks) },
    previous: {
      spend: Math.round(total(spend) * 0.93),
      impressions: Math.round(total(impressions) * 0.95),
      clicks: Math.round(total(clicks) * 0.9)
    },
    daily: { spend, impressions, clicks },
    previousDaily: {
      spend: spend.map((v) => Math.round(v * 0.93)),
      impressions: impressions.map((v) => Math.round(v * 0.95)),
      clicks: clicks.map((v) => Math.round(v * 0.9))
    },
    landingPageViews: { value: Math.round(total(clicks) * 0.72), previous: Math.round(total(clicks) * 0.66), daily: clicks.map((c) => Math.round(c * 0.72)) },
    metrics: [
      metricEntry(
        { id: 'lead', label: 'Leads', targetCostPer: 50 },
        total(spend),
        total(spend) * 0.93,
        total(leadsDaily),
        Math.round(total(leadsDaily) * 0.85),
        leadsDaily,
        leadsDaily.map((v) => Math.max(0, v - 1))
      )
    ]
  };
  const camp = (name, share, resShare) => {
    const spendC = round2(meta.totals.spend * share);
    const results = Math.round(meta.metrics[0].value * resShare);
    return {
      name,
      channel: 'meta',
      spend: spendC,
      impressions: Math.round(meta.totals.impressions * share),
      clicks: Math.round(meta.totals.clicks * share),
      results,
      costPer: costPer(spendC, results),
      metricLabel: 'Leads',
      events: { lead: results },
      previous: {
        spend: round2(spendC * 0.93),
        impressions: Math.round(meta.totals.impressions * share * 0.95),
        clicks: Math.round(meta.totals.clicks * share * 0.9),
        results: Math.max(0, results - 2),
        events: { lead: Math.max(0, results - 2) }
      }
    };
  };
  return {
    isDemo: true,
    ...window,
    dates,
    channels: { meta, google: emptyChannel('not-connected') },
    campaigns: [camp('Spring offer — leads', 0.7, 0.75), camp('Retargeting — warm traffic', 0.3, 0.25)]
  };
}

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const qs = event.queryStringParameters || {};
  const custom = resolveCustomRange(qs.since, qs.until);
  const range = custom ? 'custom' : VALID_RANGES.includes(qs.range) ? qs.range : 'last_7d';
  const { since, until, prevSince, prevUntil } = custom || resolveRange(range);
  const dates = listDays(since, until);
  const prevDates = listDays(prevSince, prevUntil);
  const dateIndex = Object.fromEntries(dates.map((d, i) => [d, i]));
  const prevDateIndex = Object.fromEntries(prevDates.map((d, i) => [d, i]));
  const window = { range, since, until, prevSince, prevUntil };

  const user = await getUser(email);
  const meta = user.accounts.meta;
  const google = user.accounts.google;
  if (!meta || !meta.selectedAdAccountId) {
    return json(200, demoReport(window, dates));
  }

  const campaigns = [];

  // ---------------- Meta: its own selected metrics ----------------
  const metaChannel = emptyChannel('ok');
  const metaMetrics = getSelectedMetrics(meta); // defaults to Leads pre-setup
  const LPV = 'landing_page_view';
  const metaIds = [...metaMetrics.map((m) => m.id), LPV, ...Object.values(EXTRA_ACTIONS)];
  const FIELDS = 'spend,actions,impressions,clicks,reach';
  try {
    const insights = (extra) =>
      metaGet(`${meta.selectedAdAccountId}/insights`, { access_token: meta.accessToken, ...extra });
    const [dailyRows, totalRows, prevTotalRows, prevDailyRows, campaignRows, prevCampaignRows] = await Promise.all([
      insights({ fields: FIELDS, time_range: JSON.stringify({ since, until }), time_increment: 1, limit: 100 }),
      insights({ fields: FIELDS, time_range: JSON.stringify({ since, until }) }),
      insights({ fields: FIELDS, time_range: JSON.stringify({ since: prevSince, until: prevUntil }) }),
      insights({ fields: 'spend,actions,impressions,clicks', time_range: JSON.stringify({ since: prevSince, until: prevUntil }), time_increment: 1, limit: 100 }),
      insights({ fields: 'campaign_name,spend,impressions,clicks,actions', level: 'campaign', time_range: JSON.stringify({ since, until }), limit: 500 }),
      insights({ fields: 'campaign_name,spend,impressions,clicks,actions', level: 'campaign', time_range: JSON.stringify({ since: prevSince, until: prevUntil }), limit: 500 })
    ]);

    const byDate = {};
    dailyRows.forEach((row) => {
      byDate[row.date_start] = { ...readRow(row, metaIds), reach: parseInt(row.reach || 0, 10) };
    });
    const byPrevDate = {};
    prevDailyRows.forEach((row) => {
      byPrevDate[row.date_start] = readRow(row, metaIds);
    });
    const totals = sumRows(totalRows.length ? totalRows : dailyRows, metaIds);
    const prev = sumRows(prevTotalRows, metaIds);

    metaChannel.totals = { spend: round2(totals.spend), impressions: totals.impressions, clicks: totals.clicks };
    metaChannel.previous = { spend: round2(prev.spend), impressions: prev.impressions, clicks: prev.clicks };
    metaChannel.daily = {
      spend: dates.map((d) => (byDate[d] ? round2(byDate[d].spend) : 0)),
      impressions: dates.map((d) => (byDate[d] ? byDate[d].impressions : 0)),
      clicks: dates.map((d) => (byDate[d] ? byDate[d].clicks : 0))
    };
    metaChannel.previousDaily = {
      spend: prevDates.map((d) => (byPrevDate[d] ? round2(byPrevDate[d].spend) : 0)),
      impressions: prevDates.map((d) => (byPrevDate[d] ? byPrevDate[d].impressions : 0)),
      clicks: prevDates.map((d) => (byPrevDate[d] ? byPrevDate[d].clicks : 0))
    };
    metaChannel.landingPageViews = {
      value: totals.values[LPV],
      previous: prev.values[LPV],
      daily: dates.map((d) => (byDate[d] ? byDate[d].values[LPV] : 0))
    };
    // Reach totals come from the aggregate row - daily reach never sums to
    // unique reach. Frequency is derived client-side (impressions / reach).
    const reachNow = parseInt((totalRows[0] || {}).reach || 0, 10);
    const reachPrev = parseInt((prevTotalRows[0] || {}).reach || 0, 10);
    const extraSeries = (action) => ({
      value: totals.values[action] || 0,
      previous: prev.values[action] || 0,
      daily: dates.map((d) => (byDate[d] ? byDate[d].values[action] : 0))
    });
    metaChannel.extras = {
      reach: { value: reachNow, previous: reachPrev, daily: dates.map((d) => (byDate[d] ? byDate[d].reach : 0)) },
      video_views: extraSeries(EXTRA_ACTIONS.video_views),
      thruplays: extraSeries(EXTRA_ACTIONS.thruplays),
      engagement: extraSeries(EXTRA_ACTIONS.engagement)
    };
    metaChannel.metrics = metaMetrics.map((m) =>
      metricEntry(
        m,
        totals.spend,
        prev.spend,
        totals.values[m.id],
        prev.values[m.id],
        dates.map((d) => (byDate[d] ? byDate[d].values[m.id] : 0)),
        prevDates.map((d) => (byPrevDate[d] ? byPrevDate[d].values[m.id] : 0))
      )
    );

    // Campaign summaries: primary metric headline plus every selected
    // event's value, with the matched previous-period row for deltas.
    const primary = metaMetrics[0];
    const eventIds = metaMetrics.map((m) => m.id);
    const prevByName = {};
    prevCampaignRows.forEach((row) => {
      prevByName[row.campaign_name] = row;
    });
    campaignRows.forEach((row) => {
      const spend = parseFloat(row.spend || 0);
      const events = extractValues(row, eventIds);
      const results = events[primary.id];
      if (spend <= 0) return;
      const p = prevByName[row.campaign_name];
      const prevEvents = p ? extractValues(p, eventIds) : null;
      campaigns.push({
        name: row.campaign_name,
        channel: 'meta',
        spend: round2(spend),
        impressions: parseInt(row.impressions || 0, 10),
        clicks: parseInt(row.clicks || 0, 10),
        results,
        costPer: costPer(spend, results),
        metricLabel: primary.label,
        events,
        previous: p
          ? {
              spend: round2(parseFloat(p.spend || 0)),
              impressions: parseInt(p.impressions || 0, 10),
              clicks: parseInt(p.clicks || 0, 10),
              results: prevEvents[primary.id],
              events: prevEvents
            }
          : null
      });
    });
  } catch (err) {
    return json(200, {
      ...demoReport(window, dates),
      error: 'Could not fetch live data, showing demo data instead.'
    });
  }

  // ---------------- Google: its own selected metrics ----------------
  let googleChannel;
  if (!google) {
    googleChannel = emptyChannel('not-connected');
  } else if (!google.selectedAdAccountId) {
    googleChannel = emptyChannel('no-account');
  } else {
    const googleMetrics = google.selectedMetrics || []; // NO Leads default - Google picks its own
    googleChannel = emptyChannel(googleMetrics.length ? 'ok' : 'no-metrics');
    try {
      const account = (google.adAccounts || []).find((a) => a.id === google.selectedAdAccountId);
      const opts = { loginCustomerId: account && account.loginCustomerId };
      const actionIds = googleMetrics.map((m) => m.id);
      const [cur, prev, convCur, convPrev] = await Promise.all([
        fetchGoogleCampaignDaily(google, google.selectedAdAccountId, since, until, opts),
        fetchGoogleCampaignDaily(google, google.selectedAdAccountId, prevSince, prevUntil, opts),
        fetchGoogleConversionsDaily(google, google.selectedAdAccountId, since, until, actionIds, opts),
        fetchGoogleConversionsDaily(google, google.selectedAdAccountId, prevSince, prevUntil, actionIds, opts)
      ]);
      if (cur.tokenRefreshed || prev.tokenRefreshed) await saveUser(user).catch(() => {});

      const totals = { spend: 0, impressions: 0, clicks: 0 };
      const daily = { spend: dates.map(() => 0), impressions: dates.map(() => 0), clicks: dates.map(() => 0) };
      const campaignAgg = {};
      cur.rows.forEach((r) => {
        totals.spend += r.spend;
        totals.impressions += r.impressions;
        totals.clicks += r.clicks;
        const i = dateIndex[r.date];
        if (i != null) {
          daily.spend[i] = round2(daily.spend[i] + r.spend);
          daily.impressions[i] += r.impressions;
          daily.clicks[i] += r.clicks;
        }
        const agg = (campaignAgg[r.campaign] = campaignAgg[r.campaign] || { spend: 0, impressions: 0, clicks: 0 });
        agg.spend += r.spend;
        agg.impressions += r.impressions;
        agg.clicks += r.clicks;
      });
      const previous = { spend: 0, impressions: 0, clicks: 0 };
      const prevDaily = { spend: prevDates.map(() => 0), impressions: prevDates.map(() => 0), clicks: prevDates.map(() => 0) };
      const campaignPrevAgg = {};
      prev.rows.forEach((r) => {
        previous.spend += r.spend;
        previous.impressions += r.impressions;
        previous.clicks += r.clicks;
        const i = prevDateIndex[r.date];
        if (i != null) {
          prevDaily.spend[i] = round2(prevDaily.spend[i] + r.spend);
          prevDaily.impressions[i] += r.impressions;
          prevDaily.clicks[i] += r.clicks;
        }
        const agg = (campaignPrevAgg[r.campaign] = campaignPrevAgg[r.campaign] || { spend: 0, impressions: 0, clicks: 0 });
        agg.spend += r.spend;
        agg.impressions += r.impressions;
        agg.clicks += r.clicks;
      });
      googleChannel.totals = { spend: round2(totals.spend), impressions: totals.impressions, clicks: totals.clicks };
      googleChannel.previous = { spend: round2(previous.spend), impressions: previous.impressions, clicks: previous.clicks };
      googleChannel.daily = daily;
      googleChannel.previousDaily = prevDaily;

      // Per selected action: daily series + totals now and before.
      const actionSlot = () => ({ now: 0, before: 0, daily: dates.map(() => 0), prevDaily: prevDates.map(() => 0), byCampaign: {}, byCampaignPrev: {} });
      const perAction = {};
      actionIds.forEach((id) => {
        perAction[id] = actionSlot();
      });
      convCur.rows.forEach((r) => {
        const slot = perAction[r.action];
        if (!slot) return;
        slot.now += r.conversions;
        const i = dateIndex[r.date];
        if (i != null) slot.daily[i] = +(slot.daily[i] + r.conversions).toFixed(1);
        slot.byCampaign[r.campaign] = (slot.byCampaign[r.campaign] || 0) + r.conversions;
      });
      convPrev.rows.forEach((r) => {
        const slot = perAction[r.action];
        if (!slot) return;
        slot.before += r.conversions;
        const i = prevDateIndex[r.date];
        if (i != null) slot.prevDaily[i] = +(slot.prevDaily[i] + r.conversions).toFixed(1);
        slot.byCampaignPrev[r.campaign] = (slot.byCampaignPrev[r.campaign] || 0) + r.conversions;
      });
      googleChannel.metrics = googleMetrics.map((m) => {
        const slot = perAction[m.id];
        return metricEntry(m, totals.spend, previous.spend, +slot.now.toFixed(1), +slot.before.toFixed(1), slot.daily, slot.prevDaily);
      });

      // Campaign summaries on Google's primary metric plus every selected
      // event, with previous-period aggregates for deltas.
      const gPrimary = googleMetrics[0];
      Object.entries(campaignAgg).forEach(([name, agg]) => {
        if (agg.spend <= 0) return;
        const events = {};
        actionIds.forEach((id) => {
          events[id] = +(perAction[id].byCampaign[name] || 0).toFixed(1);
        });
        const results = gPrimary ? events[gPrimary.id] : null;
        const p = campaignPrevAgg[name];
        const prevEvents = {};
        actionIds.forEach((id) => {
          prevEvents[id] = +(perAction[id].byCampaignPrev[name] || 0).toFixed(1);
        });
        campaigns.push({
          name,
          channel: 'google',
          spend: round2(agg.spend),
          impressions: agg.impressions,
          clicks: agg.clicks,
          results,
          costPer: gPrimary ? costPer(agg.spend, results) : null,
          metricLabel: gPrimary ? gPrimary.label : null,
          events,
          previous: p
            ? {
                spend: round2(p.spend),
                impressions: p.impressions,
                clicks: p.clicks,
                results: gPrimary ? prevEvents[gPrimary.id] : null,
                events: prevEvents
              }
            : null
        });
      });
    } catch (err) {
      console.error(`[get-report] Google Ads fetch failed: ${err.message}`);
      googleChannel = emptyChannel('error');
      googleChannel.error = err.message;
    }
  }

  return json(200, {
    isDemo: false,
    ...window,
    dates,
    prevDates,
    channels: { meta: metaChannel, google: googleChannel },
    campaigns: campaigns.sort((a, b) => b.spend - a.spend)
  });
};
