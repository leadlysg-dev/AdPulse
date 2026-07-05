// Week-by-week history for the last 12 weeks, fetched on demand from the
// Meta insights API (time_increment=7 returns one row per week in a single
// call - nothing extra is stored). Reports the customer's own selected
// metrics, defaulting to Leads. Demo data when no account is connected.
const { getEmailFromRequest, getUser } = require('./_store');
const { fmt, addDays } = require('./_dates');
const { metaGet, readRow } = require('./_meta');
const { getSelectedMetrics } = require('./_metrics');
const { demoHistory } = require('./_demo');

const WEEKS = 12;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const user = await getUser(email);
  const meta = user.accounts.meta;
  if (!meta || !meta.selectedAdAccountId) {
    return json(200, demoHistory(WEEKS));
  }

  const selectedMetrics = getSelectedMetrics(meta);
  const metricIds = selectedMetrics.map((m) => m.id);

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = fmt(addDays(today, -(WEEKS * 7 - 1)));
  const until = fmt(today);

  try {
    const rows = await metaGet(`${meta.selectedAdAccountId}/insights`, {
      fields: 'spend,actions',
      time_range: JSON.stringify({ since, until }),
      time_increment: 7,
      limit: 50,
      access_token: meta.accessToken
    });

    const weeks = rows.map((row) => {
      const r = readRow(row, metricIds);
      return {
        start: row.date_start,
        end: row.date_stop,
        spend: +r.spend.toFixed(2),
        values: r.values
      };
    });

    return json(200, { isDemo: false, metrics: selectedMetrics, weeks });
  } catch (err) {
    return json(502, { error: 'Could not fetch weekly history from Meta. ' + err.message });
  }
};
