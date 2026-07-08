// Campaign-classified report data for the Reporting tab. Campaigns whose
// name contains "lead" (any case) count as Leads campaigns; everything else
// is Brand Awareness. The response carries per-day and period aggregates
// split by channel x type, plus per-campaign summaries, so the TYPE and
// CHANNEL filters compose entirely on the client - one fetch per date range.
//
// "results" throughout = the customer's primary tracked metric (Leads,
// Purchases, ...) on Meta, and conversions on Google.
const { getEmailFromRequest, getUser, saveUser } = require('./_store');
const { VALID_RANGES, resolveRange, resolveCustomRange, listDays } = require('./_dates');
const { metaGet } = require('./_meta');
const { getSelectedMetrics, extractValues } = require('./_metrics');
const { fetchGoogleCampaignDaily } = require('./_googleAds');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const classify = (name) => (/lead/i.test(name || '') ? 'leads' : 'ba');

const emptyCell = () => ({ spend: 0, impressions: 0, clicks: 0, results: 0, reach: 0 });
const emptyDaily = (n) => ({
  spend: Array(n).fill(0),
  results: Array(n).fill(0),
  impressions: Array(n).fill(0),
  clicks: Array(n).fill(0)
});
const emptySplit = (make) => ({
  meta: { leads: make(), ba: make() },
  google: { leads: make(), ba: make() }
});

const round2 = (v) => +v.toFixed(2);
function finishCells(split) {
  for (const ch of ['meta', 'google']) {
    for (const ty of ['leads', 'ba']) {
      split[ch][ty].spend = round2(split[ch][ty].spend);
      split[ch][ty].results = +split[ch][ty].results.toFixed(1);
    }
  }
  return split;
}

// Deterministic sample report so the tab reads correctly before any account
// is connected (or when Meta errors out).
function demoReport(window, dates) {
  const n = dates.length;
  const daily = emptySplit(() => emptyDaily(n));
  const totals = emptySplit(emptyCell);
  const previous = emptySplit(emptyCell);
  const wave = (i, base, amp, f) => Math.max(0, Math.round(base + amp * Math.sin(i / f)));
  for (let i = 0; i < n; i++) {
    const leadSpend = wave(i, 52, 14, 4);
    const baSpend = wave(i, 18, 6, 5);
    daily.meta.leads.spend[i] = leadSpend;
    daily.meta.leads.results[i] = wave(i, 3, 2, 3);
    daily.meta.leads.impressions[i] = leadSpend * 34;
    daily.meta.leads.clicks[i] = Math.round(leadSpend * 0.42);
    daily.meta.ba.spend[i] = baSpend;
    daily.meta.ba.impressions[i] = baSpend * 95;
    daily.meta.ba.clicks[i] = Math.round(baSpend * 0.2);
  }
  for (const ty of ['leads', 'ba']) {
    for (const key of ['spend', 'results', 'impressions', 'clicks']) {
      totals.meta[ty][key] = daily.meta[ty][key].reduce((a, b) => a + b, 0);
      previous.meta[ty][key] = Math.round(totals.meta[ty][key] * 0.92);
    }
  }
  totals.meta.ba.reach = Math.round(totals.meta.ba.impressions * 0.55);
  previous.meta.ba.reach = Math.round(totals.meta.ba.reach * 0.9);
  const campaigns = [
    { name: 'Spring offer LEADS', channel: 'meta', type: 'leads', spend: round2(totals.meta.leads.spend * 0.7), impressions: Math.round(totals.meta.leads.impressions * 0.7), clicks: Math.round(totals.meta.leads.clicks * 0.7), results: Math.round(totals.meta.leads.results * 0.75), reach: 0 },
    { name: 'Retargeting LEADS', channel: 'meta', type: 'leads', spend: round2(totals.meta.leads.spend * 0.3), impressions: Math.round(totals.meta.leads.impressions * 0.3), clicks: Math.round(totals.meta.leads.clicks * 0.3), results: Math.round(totals.meta.leads.results * 0.25), reach: 0 },
    { name: 'Always-on brand video', channel: 'meta', type: 'ba', spend: round2(totals.meta.ba.spend), impressions: totals.meta.ba.impressions, clicks: totals.meta.ba.clicks, results: 0, reach: totals.meta.ba.reach }
  ].map((c) => ({ ...c, costPer: c.results > 0 ? round2(c.spend / c.results) : null }));
  return {
    isDemo: true,
    ...window,
    primaryMetric: { id: 'lead', label: 'Leads', targetCostPer: 50 },
    dates,
    daily,
    totals: finishCells(totals),
    previous: finishCells(previous),
    campaigns,
    googleStatus: 'not-connected'
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
  const dateIndex = Object.fromEntries(dates.map((d, i) => [d, i]));
  const window = { range, since, until, prevSince, prevUntil };

  const user = await getUser(email);
  const meta = user.accounts.meta;
  const google = user.accounts.google;
  if (!meta || !meta.selectedAdAccountId) {
    return json(200, demoReport(window, dates));
  }

  const primary = getSelectedMetrics(meta)[0];
  const daily = emptySplit(() => emptyDaily(dates.length));
  const totals = emptySplit(emptyCell);
  const previous = emptySplit(emptyCell);
  const campaignMap = new Map(); // "channel|name" -> summary row

  const campaignRow = (channel, name, type) => {
    const key = `${channel}|${name}`;
    if (!campaignMap.has(key)) {
      campaignMap.set(key, { name, channel, type, ...emptyCell() });
    }
    return campaignMap.get(key);
  };

  try {
    const insightParams = (window) => ({
      fields: 'campaign_name,spend,impressions,clicks,actions',
      level: 'campaign',
      time_range: JSON.stringify(window),
      limit: 500,
      access_token: meta.accessToken
    });
    const [dailyRows, reachRows, prevRows] = await Promise.all([
      metaGet(`${meta.selectedAdAccountId}/insights`, {
        ...insightParams({ since, until }),
        time_increment: 1
      }),
      // Reach can't be summed across days (people overlap), so the period
      // figure comes from its own un-broken-down call.
      metaGet(`${meta.selectedAdAccountId}/insights`, {
        fields: 'campaign_name,reach',
        level: 'campaign',
        time_range: JSON.stringify({ since, until }),
        limit: 500,
        access_token: meta.accessToken
      }),
      metaGet(`${meta.selectedAdAccountId}/insights`, insightParams({ since: prevSince, until: prevUntil }))
    ]);

    dailyRows.forEach((row) => {
      const type = classify(row.campaign_name);
      const i = dateIndex[row.date_start];
      const spend = parseFloat(row.spend || 0);
      const impressions = parseInt(row.impressions || 0, 10);
      const clicks = parseInt(row.clicks || 0, 10);
      const results = extractValues(row, [primary.id])[primary.id];
      if (i != null) {
        daily.meta[type].spend[i] = round2(daily.meta[type].spend[i] + spend);
        daily.meta[type].results[i] += results;
        daily.meta[type].impressions[i] += impressions;
        daily.meta[type].clicks[i] += clicks;
      }
      totals.meta[type].spend += spend;
      totals.meta[type].impressions += impressions;
      totals.meta[type].clicks += clicks;
      totals.meta[type].results += results;
      const c = campaignRow('meta', row.campaign_name, type);
      c.spend += spend;
      c.impressions += impressions;
      c.clicks += clicks;
      c.results += results;
    });
    reachRows.forEach((row) => {
      const type = classify(row.campaign_name);
      const reach = parseInt(row.reach || 0, 10);
      totals.meta[type].reach += reach;
      campaignRow('meta', row.campaign_name, type).reach = reach;
    });
    prevRows.forEach((row) => {
      const type = classify(row.campaign_name);
      previous.meta[type].spend += parseFloat(row.spend || 0);
      previous.meta[type].impressions += parseInt(row.impressions || 0, 10);
      previous.meta[type].clicks += parseInt(row.clicks || 0, 10);
      previous.meta[type].results += extractValues(row, [primary.id])[primary.id];
    });
  } catch (err) {
    return json(200, {
      ...demoReport(window, dates),
      error: 'Could not fetch live data, showing demo data instead.'
    });
  }

  // Google rides along; its failure never blanks the Meta report.
  let googleStatus = 'ok';
  let googleError;
  if (!google) {
    googleStatus = 'not-connected';
  } else if (!google.selectedAdAccountId) {
    googleStatus = 'no-account';
  } else {
    try {
      const selected = (google.adAccounts || []).find((a) => a.id === google.selectedAdAccountId);
      const opts = { loginCustomerId: selected && selected.loginCustomerId };
      const [cur, prev] = await Promise.all([
        fetchGoogleCampaignDaily(google, google.selectedAdAccountId, since, until, opts),
        fetchGoogleCampaignDaily(google, google.selectedAdAccountId, prevSince, prevUntil, opts)
      ]);
      if (cur.tokenRefreshed || prev.tokenRefreshed) await saveUser(user).catch(() => {});
      cur.rows.forEach((r) => {
        const type = classify(r.campaign);
        const i = dateIndex[r.date];
        if (i != null) {
          daily.google[type].spend[i] = round2(daily.google[type].spend[i] + r.spend);
          daily.google[type].results[i] = +(daily.google[type].results[i] + r.conversions).toFixed(1);
          daily.google[type].impressions[i] += r.impressions;
          daily.google[type].clicks[i] += r.clicks;
        }
        totals.google[type].spend += r.spend;
        totals.google[type].impressions += r.impressions;
        totals.google[type].clicks += r.clicks;
        totals.google[type].results += r.conversions;
        const c = campaignRow('google', r.campaign, type);
        c.spend += r.spend;
        c.impressions += r.impressions;
        c.clicks += r.clicks;
        c.results += r.conversions;
      });
      prev.rows.forEach((r) => {
        const type = classify(r.campaign);
        previous.google[type].spend += r.spend;
        previous.google[type].impressions += r.impressions;
        previous.google[type].clicks += r.clicks;
        previous.google[type].results += r.conversions;
      });
    } catch (err) {
      console.error(`[get-report] Google Ads fetch failed: ${err.message}`);
      googleStatus = 'error';
      googleError = err.message;
    }
  }

  const campaigns = [...campaignMap.values()]
    .map((c) => ({
      ...c,
      spend: round2(c.spend),
      results: +c.results.toFixed(1),
      costPer: c.results > 0 ? round2(c.spend / c.results) : null
    }))
    .sort((a, b) => b.spend - a.spend);

  return json(200, {
    isDemo: false,
    ...window,
    primaryMetric: {
      id: primary.id,
      label: primary.label,
      targetCostPer: primary.targetCostPer != null ? primary.targetCostPer : null
    },
    dates,
    daily,
    totals: finishCells(totals),
    previous: finishCells(previous),
    campaigns,
    googleStatus,
    ...(googleError ? { googleError } : {})
  });
};
