// When results arrive: a day-of-week × hour-of-day grid of the workspace's
// mapped primary result, straight from each platform's own hourly
// breakdowns (Meta: hourly_stats_aggregated_by_advertiser_time_zone,
// Google: segments.day_of_week + segments.hour filtered to the mapped
// conversion action). Both platforms count the mapped event, so the grid
// may blend them - same rule as the headline number.
const { getEmailFromRequest, getWorkspaceFromRequest, getMetricsConfig, getDataUser } = require('./_store');
const { VALID_RANGES, resolveRange, resolveCustomRange } = require('./_dates');
const { metaGet } = require('./_meta');
const { getSelectedMetrics } = require('./_metrics');
const { gadsSearch } = require('./_googleAds');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

// ISO-ish: rows are Monday-first.
const DOW = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const dowOfDate = (iso) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const qs = event.queryStringParameters || {};
  const custom = resolveCustomRange(qs.since, qs.until);
  const range = custom ? 'custom' : VALID_RANGES.includes(qs.range) ? qs.range : 'last_30d';
  const { since, until } = custom || resolveRange(range);
  const platform = ['all', 'meta', 'google'].includes(qs.platform) ? qs.platform : 'all';

  const workspace = await getWorkspaceFromRequest(event.headers, email);
  const user = await getDataUser(email, workspace);
  if (!user) return json(401, { error: 'Not logged in.' });
  const config = workspace.id ? await getMetricsConfig(workspace.id).catch(() => null) : null;

  const cells = Array.from({ length: 7 }, () => Array(24).fill(0));
  let total = 0;
  const platforms = [];

  // ---- Meta ----
  const meta = user.accounts && user.accounts.meta;
  const metaEvent =
    (config && config.primaryResult && config.primaryResult.meta && config.primaryResult.meta.event) ||
    (meta && meta.selectedAdAccountId ? getSelectedMetrics(meta)[0].id : null);
  if (platform !== 'google' && meta && meta.selectedAdAccountId && metaEvent) {
    try {
      const rows = await metaGet(`${meta.selectedAdAccountId}/insights`, {
        fields: 'actions',
        time_range: JSON.stringify({ since, until }),
        time_increment: 1,
        breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
        limit: 1000,
        access_token: meta.accessToken
      });
      rows.forEach((row) => {
        const bucket = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
        const hour = parseInt(bucket.slice(0, 2), 10);
        const action = (row.actions || []).find((a) => a.action_type === metaEvent);
        if (!action || !isFinite(hour) || !row.date_start) return;
        const v = Number(action.value) || 0;
        cells[dowOfDate(row.date_start)][hour] += v;
        total += v;
      });
      platforms.push('meta');
    } catch (err) {
      console.error(`[get-heatmap] Meta hourly failed: ${err.message}`);
    }
  }

  // ---- Google ----
  const google = user.accounts && user.accounts.google;
  const googleEvent = config && config.primaryResult && config.primaryResult.google && config.primaryResult.google.event;
  if (platform !== 'meta' && google && google.selectedAdAccountId && googleEvent) {
    try {
      const account = (google.adAccounts || []).find((a) => a.id === google.selectedAdAccountId);
      const { results } = await gadsSearch(
        google,
        google.selectedAdAccountId,
        'SELECT segments.day_of_week, segments.hour, segments.conversion_action, metrics.all_conversions ' +
          `FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`,
        { loginCustomerId: account && account.loginCustomerId }
      );
      results.forEach((row) => {
        const s = row.segments || {};
        if (s.conversionAction !== googleEvent) return;
        const d = DOW.indexOf(s.dayOfWeek);
        const hour = parseInt(s.hour, 10);
        if (d < 0 || !isFinite(hour)) return;
        const v = Number((row.metrics || {}).allConversions || 0);
        cells[d][hour] += v;
        total += v;
      });
      platforms.push('google');
    } catch (err) {
      console.error(`[get-heatmap] Google hourly failed: ${err.message}`);
    }
  }

  return json(200, {
    range,
    since,
    until,
    platforms,
    total: +total.toFixed(1),
    cells: cells.map((r) => r.map((v) => +v.toFixed(1)))
  });
};
