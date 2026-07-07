// Pulls the logged-in customer's real numbers for the requested date range:
// a daily breakdown for the charts, period totals for the tiles, and the
// equivalent prior period so the frontend can phrase "vs previous period"
// insights. Which conversion metrics are reported is the customer's own
// selection (selectedMetrics), defaulting to Leads for accounts that
// haven't picked yet.
//
// ?channel= filters the source: 'meta', 'google', or 'all' (default).
// - meta: exactly the Meta account's numbers, as before.
// - google: Google Ads spend/delivery, with Google's own conversions as the
//   single tracked metric (Google doesn't share Meta's per-event metric ids).
// - all: Meta plus Google blended into spend/impressions/clicks; conversion
//   metrics stay Meta's tracked events with cost-per computed against Meta
//   spend only, so a lead's cost is never inflated by Google budget.
// Google trouble never breaks the response: the Meta numbers come back with
// a googleError note instead. Falls back to labelled demo data if the
// customer hasn't connected Meta yet, so the dashboard never looks broken.
const { getEmailFromRequest, getUser, saveUser } = require('./_store');
const { VALID_RANGES, resolveRange, resolveCustomRange, listDays } = require('./_dates');
const { metaGet, readRow, sumRows, costPer } = require('./_meta');
const { getSelectedMetrics } = require('./_metrics');
const { fetchGoogleDaily } = require('./_googleAds');
const { demoDashboard } = require('./_demo');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const CHANNELS = ['all', 'meta', 'google'];

// Current + previous period from Google Ads, in the dashboard's shape.
async function googlePeriods(google, since, until, prevSince, prevUntil) {
  const [cur, prev] = await Promise.all([
    fetchGoogleDaily(google, google.selectedAdAccountId, since, until),
    fetchGoogleDaily(google, google.selectedAdAccountId, prevSince, prevUntil)
  ]);
  return { cur, prev, tokenRefreshed: cur.tokenRefreshed || prev.tokenRefreshed };
}

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const qs = event.queryStringParameters || {};
  // A valid explicit since/until pair (custom picker) wins over named ranges.
  const custom = resolveCustomRange(qs.since, qs.until);
  const range = custom ? 'custom' : VALID_RANGES.includes(qs.range) ? qs.range : 'last_30d';
  const channel = CHANNELS.includes(qs.channel) ? qs.channel : 'all';

  const user = await getUser(email);
  const meta = user.accounts.meta;
  const metaReady = meta && meta.selectedAdAccountId;
  const google = user.accounts.google;
  const googleReady = google && google.selectedAdAccountId;

  const { since, until, prevSince, prevUntil } = custom || resolveRange(range);
  const dates = listDays(since, until);
  const window = { isDemo: false, range, channel, since, until, prevSince, prevUntil };

  // Google-only view: no Meta calls at all.
  if (channel === 'google') {
    if (!googleReady) {
      return json(200, {
        ...window,
        googleNotReady: google ? 'no-account' : 'not-connected'
      });
    }
    try {
      const { cur, prev, tokenRefreshed } = await googlePeriods(google, since, until, prevSince, prevUntil);
      if (tokenRefreshed) await saveUser(user).catch(() => {});
      const day = (d, key) => (cur.byDate[d] ? cur.byDate[d][key] : 0);
      const conversions = +cur.totals.conversions.toFixed(1);
      const prevConversions = +prev.totals.conversions.toFixed(1);
      return json(200, {
        ...window,
        spend: +cur.totals.spend.toFixed(2),
        metaSpend: 0,
        googleSpend: +cur.totals.spend.toFixed(2),
        impressions: cur.totals.impressions,
        clicks: cur.totals.clicks,
        landingPageViews: null, // Meta-only concept; the card shows a dash
        revenue: 0,
        previous: {
          spend: +prev.totals.spend.toFixed(2),
          impressions: prev.totals.impressions,
          clicks: prev.totals.clicks,
          landingPageViews: null,
          revenue: 0
        },
        metrics: [
          {
            id: 'google_conversions',
            label: 'Conversions',
            targetCostPer: null,
            canSetGoal: false,
            value: conversions,
            previous: prevConversions,
            costPer: costPer(cur.totals.spend, conversions),
            prevCostPer: costPer(prev.totals.spend, prevConversions),
            daily: dates.map((d) => +day(d, 'conversions').toFixed(1))
          }
        ],
        daily: {
          dates,
          spend: dates.map((d) => +day(d, 'spend').toFixed(2)),
          impressions: dates.map((d) => day(d, 'impressions')),
          clicks: dates.map((d) => day(d, 'clicks')),
          landingPageViews: dates.map(() => 0),
          revenue: dates.map(() => 0)
        }
      });
    } catch (err) {
      console.error(`[get-dashboard-data] Google Ads fetch failed: ${err.message}`);
      return json(200, { ...window, googleNotReady: 'error', googleError: err.message });
    }
  }

  if (!metaReady) {
    return json(200, demoDashboard(range));
  }

  const selectedMetrics = getSelectedMetrics(meta);
  const metricIds = selectedMetrics.map((m) => m.id);
  // landing_page_view rides along in the same actions array Meta already
  // returns - extracting it costs nothing extra.
  const LPV = 'landing_page_view';
  const extractIds = [...metricIds, LPV];

  try {
    // One call with a daily breakdown covers both the charts and the period
    // totals; a second call fetches the prior period's totals for comparisons.
    // The actions field carries every conversion type at once, so the same
    // two calls serve any metric selection. Google (blended view only) runs
    // in the same round trip, and its failure downgrades to a note.
    const wantGoogle = channel === 'all' && googleReady;
    const [dailyRows, prevRows, googleResult] = await Promise.all([
      metaGet(`${meta.selectedAdAccountId}/insights`, {
        fields: 'spend,actions,impressions,clicks,action_values',
        time_range: JSON.stringify({ since, until }),
        time_increment: 1,
        limit: 100,
        access_token: meta.accessToken
      }),
      metaGet(`${meta.selectedAdAccountId}/insights`, {
        fields: 'spend,actions,impressions,clicks,action_values',
        time_range: JSON.stringify({ since: prevSince, until: prevUntil }),
        access_token: meta.accessToken
      }),
      wantGoogle
        ? googlePeriods(google, since, until, prevSince, prevUntil).catch((err) => {
            console.error(`[get-dashboard-data] Google Ads fetch failed: ${err.message}`);
            return { error: err.message };
          })
        : Promise.resolve(null)
    ]);

    // The API only returns rows for days with activity - fill the gaps so
    // the charts show a continuous timeline.
    const byDate = {};
    dailyRows.forEach((row) => {
      byDate[row.date_start] = readRow(row, extractIds);
    });
    const dailySpend = dates.map((d) => (byDate[d] ? +byDate[d].spend.toFixed(2) : 0));
    const dailyImpressions = dates.map((d) => (byDate[d] ? byDate[d].impressions : 0));
    const dailyClicks = dates.map((d) => (byDate[d] ? byDate[d].clicks : 0));
    const dailyRevenue = dates.map((d) => (byDate[d] ? +byDate[d].revenue.toFixed(2) : 0));
    const dailyLpv = dates.map((d) => (byDate[d] ? byDate[d].values[LPV] : 0));

    const totals = sumRows(dailyRows, extractIds);
    const prev = sumRows(prevRows, extractIds);

    // Cost-per for tracked metrics is Meta spend over Meta events, computed
    // before any Google spend is blended in.
    const metrics = selectedMetrics.map((m) => ({
      id: m.id,
      label: m.label,
      targetCostPer: m.targetCostPer != null ? m.targetCostPer : null,
      value: totals.values[m.id],
      previous: prev.values[m.id],
      costPer: costPer(totals.spend, totals.values[m.id]),
      prevCostPer: costPer(prev.spend, prev.values[m.id]),
      daily: dates.map((d) => (byDate[d] ? byDate[d].values[m.id] : 0))
    }));

    const g = googleResult && !googleResult.error ? googleResult : null;
    if (g && g.tokenRefreshed) await saveUser(user).catch(() => {});
    const gDay = (d, key) => (g && g.cur.byDate[d] ? g.cur.byDate[d][key] : 0);
    const gSpend = g ? +g.cur.totals.spend.toFixed(2) : 0;

    return json(200, {
      ...window,
      spend: +(totals.spend + (g ? g.cur.totals.spend : 0)).toFixed(2),
      metaSpend: +totals.spend.toFixed(2),
      googleSpend: gSpend,
      impressions: totals.impressions + (g ? g.cur.totals.impressions : 0),
      clicks: totals.clicks + (g ? g.cur.totals.clicks : 0),
      landingPageViews: totals.values[LPV],
      revenue: +totals.revenue.toFixed(2),
      googleError: googleResult && googleResult.error ? googleResult.error : undefined,
      previous: {
        spend: +(prev.spend + (g ? g.prev.totals.spend : 0)).toFixed(2),
        impressions: prev.impressions + (g ? g.prev.totals.impressions : 0),
        clicks: prev.clicks + (g ? g.prev.totals.clicks : 0),
        landingPageViews: prev.values[LPV],
        revenue: +prev.revenue.toFixed(2)
      },
      metrics,
      daily: {
        dates,
        spend: dates.map((d, i) => +(dailySpend[i] + gDay(d, 'spend')).toFixed(2)),
        impressions: dates.map((d, i) => dailyImpressions[i] + gDay(d, 'impressions')),
        clicks: dates.map((d, i) => dailyClicks[i] + gDay(d, 'clicks')),
        landingPageViews: dailyLpv,
        revenue: dailyRevenue
      }
    });
  } catch (err) {
    return json(200, {
      ...demoDashboard(range),
      error: 'Could not fetch live data, showing demo data instead.'
    });
  }
};
