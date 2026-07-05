// Builds the account-specific conversion-metric checklist for the picker.
// Meta has no "list every possible column" endpoint, so the list is merged
// from three sources: action types that actually fired for this account in
// the last 90 days (with their counts), the account's custom conversions
// (so opaque offsite_conversion.custom.<id> types get their real names),
// and a curated set of standard events that is always offered.
const { getEmailFromRequest, getUser } = require('./_store');
const { fmt, addDays } = require('./_dates');
const { metaGet } = require('./_meta');
const {
  STANDARD_EVENTS,
  IGNORED_ACTION_TYPES,
  getSelectedMetrics,
  prettifyActionType
} = require('./_metrics');

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
    // in yet - the frontend shows a "coming soon" state for this.
    return json(200, { available: false, provider: 'google', options: [], selected: [] });
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

    const customNames = {};
    customConversions.forEach((cc) => {
      customNames[`offsite_conversion.custom.${cc.id}`] = cc.name;
    });

    const observedCounts = {};
    ((insightRows[0] && insightRows[0].actions) || []).forEach((a) => {
      if (!IGNORED_ACTION_TYPES.has(a.action_type)) {
        observedCounts[a.action_type] = Number(a.value) || 0;
      }
    });

    const options = new Map();
    Object.entries(observedCounts).forEach(([id, count]) => {
      options.set(id, { id, label: customNames[id] || prettifyActionType(id), count90d: count });
    });
    STANDARD_EVENTS.forEach((e) => {
      if (!options.has(e.id)) options.set(e.id, { id: e.id, label: e.label, count90d: 0 });
    });

    // Metrics with recent activity first (most active on top), then the
    // zero-count standard events in their curated order.
    const list = [...options.values()].sort((a, b) => b.count90d - a.count90d);

    return json(200, {
      available: true,
      provider: 'meta',
      options: list,
      selected: getSelectedMetrics(meta).map((m) => m.id),
      hasSavedSelection: Array.isArray(meta.selectedMetrics) && meta.selectedMetrics.length > 0
    });
  } catch (err) {
    return json(502, { error: 'Could not fetch conversion metrics from Meta. ' + err.message });
  }
};
