// Builds the grouped, conversions-only checklist for the metric picker.
// The offering comes from the allowlist catalog in _metrics.js: canonical
// conversions (deduped across Meta's action-type aliases) plus the
// account's custom conversions - engagement metrics never appear. Counts
// come from the account's last 90 days of insights.
const { getEmailFromRequest, getUser } = require('./_store');
const { fmt, addDays } = require('./_dates');
const { metaGet } = require('./_meta');
const { getSelectedMetrics, canonicalKeyFor, buildCatalogGroups } = require('./_metrics');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const provider = (event.queryStringParameters || {}).provider;
  if (provider === 'google') {
    // Live Google Ads data (including its conversion actions) isn't wired
    // in yet - the frontend shows a "coming soon" state for this. When it
    // is wired, Google's conversion_action.category maps onto these same
    // groups.
    return json(200, { available: false, provider: 'google', groups: [], selected: [] });
  }
  if (provider !== 'meta') return json(400, { error: 'Unknown provider.' });

  const user = await getUser(email);
  const meta = user.accounts.meta;
  if (!meta || !meta.selectedAdAccountId) {
    return json(400, { error: 'Connect a Meta ad account first.' });
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = fmt(addDays(today, -89));
  const until = fmt(today);

  try {
    const [insightRows, customConversions] = await Promise.all([
      metaGet(`${meta.selectedAdAccountId}/insights`, {
        fields: 'actions',
        time_range: JSON.stringify({ since, until }),
        access_token: meta.accessToken
      }),
      metaGet(`${meta.selectedAdAccountId}/customconversions`, {
        fields: 'id,name',
        limit: 100,
        access_token: meta.accessToken
      }).catch(() => []) // some accounts can't read custom conversions - not fatal
    ]);

    const observedCounts = {};
    ((insightRows[0] && insightRows[0].actions) || []).forEach((a) => {
      observedCounts[a.action_type] = Number(a.value) || 0;
    });

    const groups = buildCatalogGroups(observedCounts, customConversions);

    // Pre-check the saved selection. Stored ids are raw action types and
    // may be a different alias of the same conversion than the one offered
    // today - match by canonical identity, not raw string.
    const storedMetrics = getSelectedMetrics(meta);
    const storedKeys = new Set(storedMetrics.map((m) => canonicalKeyFor(m.id)));
    const selected = [];
    groups.forEach((g) => {
      g.options.forEach((opt) => {
        if (storedKeys.has(canonicalKeyFor(opt.id))) selected.push(opt.id);
      });
    });

    return json(200, {
      available: true,
      provider: 'meta',
      groups,
      selected,
      hasSavedSelection: Array.isArray(meta.selectedMetrics) && meta.selectedMetrics.length > 0
    });
  } catch (err) {
    return json(502, { error: 'Could not fetch conversion metrics from Meta. ' + err.message });
  }
};
