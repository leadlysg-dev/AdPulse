// Pulls the logged-in customer's real numbers from their selected Meta ad
// account for the requested date range: a daily breakdown for the charts,
// period totals for the tiles, and the equivalent prior period so the
// frontend can phrase "vs previous period" insights. Which conversion
// metrics are reported is the customer's own selection (selectedMetrics),
// defaulting to Leads for accounts that haven't picked yet.
//
// Google Ads OAuth is connected but live Google figures still need the
// official client library wired in - they stay 0 and the frontend labels
// them "coming soon". Falls back to labelled demo data if the customer
// hasn't connected an account yet, so the dashboard never looks broken.
const { getEmailFromRequest, getUser } = require('./_store');
const { VALID_RANGES, resolveRange, listDays } = require('./_dates');
const { metaGet, readRow, sumRows, costPer } = require('./_meta');
const { getSelectedMetrics } = require('./_metrics');
const { demoDashboard } = require('./_demo');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const qs = event.queryStringParameters || {};
  const range = VALID_RANGES.includes(qs.range) ? qs.range : 'last_30d';

  const user = await getUser(email);
  const meta = user.accounts.meta;
  const metaReady = meta && meta.selectedAdAccountId;

  if (!metaReady) {
    return json(200, demoDashboard(range));
  }

  const selectedMetrics = getSelectedMetrics(meta);
  const metricIds = selectedMetrics.map((m) => m.id);
  const { since, until, prevSince, prevUntil } = resolveRange(range);

  try {
    // One call with a daily breakdown covers both the charts and the period
    // totals; a second call fetches the prior period's totals for comparisons.
    // The actions field carries every conversion type at once, so the same
    // two calls serve any metric selection.
    const [dailyRows, prevRows] = await Promise.all([
      metaGet(`${meta.selectedAdAccountId}/insights`, {
        fields: 'spend,actions',
        time_range: JSON.stringify({ since, until }),
        time_increment: 1,
        limit: 100,
        access_token: meta.accessToken
      }),
      metaGet(`${meta.selectedAdAccountId}/insights`, {
        fields: 'spend,actions',
        time_range: JSON.stringify({ since: prevSince, until: prevUntil }),
        access_token: meta.accessToken
      })
    ]);

    // The API only returns rows for days with activity - fill the gaps so
    // the charts show a continuous timeline.
    const byDate = {};
    dailyRows.forEach((row) => {
      byDate[row.date_start] = readRow(row, metricIds);
    });
    const dates = listDays(since, until);
    const dailySpend = dates.map((d) => (byDate[d] ? +byDate[d].spend.toFixed(2) : 0));

    const totals = sumRows(dailyRows, metricIds);
    const prev = sumRows(prevRows, metricIds);

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

    return json(200, {
      isDemo: false,
      range,
      since,
      until,
      prevSince,
      prevUntil,
      spend: +totals.spend.toFixed(2),
      metaSpend: +totals.spend.toFixed(2),
      googleSpend: 0,
      previous: { spend: +prev.spend.toFixed(2) },
      metrics,
      daily: { dates, spend: dailySpend }
    });
  } catch (err) {
    return json(200, {
      ...demoDashboard(range),
      error: 'Could not fetch live data, showing demo data instead.'
    });
  }
};
