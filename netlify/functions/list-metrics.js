// Builds the grouped, conversions-only checklist for the metric picker.
// The offering comes from the allowlist catalog in _metrics.js: canonical
// conversions (deduped across Meta's action-type aliases) plus the
// account's custom conversions - engagement metrics never appear. Counts
// come from the account's last 90 days of insights.
const { getEmailFromRequest, getWorkspaceFromRequest, getDataUser } = require('./_store');
const { fmt, addDays } = require('./_dates');
const { metaGet } = require('./_meta');
const { getSelectedMetrics, canonicalKeyFor, buildCatalogGroups } = require('./_metrics');
const { listGoogleConversionActions } = require('./_googleAds');

// Google conversion_action.category -> the picker's group headings.
// Anything unmapped lands in "Other conversion actions".
const GOOGLE_CATEGORY_GROUPS = {
  LEAD: 'leads_contacts',
  SUBMIT_LEAD_FORM: 'leads_contacts',
  PHONE_CALL_LEAD: 'leads_contacts',
  IMPORTED_LEAD: 'leads_contacts',
  QUALIFIED_LEAD: 'leads_contacts',
  CONVERTED_LEAD: 'leads_contacts',
  CONTACT: 'leads_contacts',
  SIGNUP: 'leads_contacts',
  REQUEST_QUOTE: 'leads_contacts',
  PURCHASE: 'sales',
  ADD_TO_CART: 'sales',
  BEGIN_CHECKOUT: 'sales',
  SUBSCRIBE_PAID: 'sales',
  BOOK_APPOINTMENT: 'appointments'
};
const GOOGLE_GROUP_LABELS = [
  { id: 'leads_contacts', label: 'Leads & contacts' },
  { id: 'sales', label: 'Sales & purchases' },
  { id: 'appointments', label: 'Appointments & bookings' },
  { id: 'other', label: 'Other conversion actions' }
];

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  const provider = (event.queryStringParameters || {}).provider;
  if (!['meta', 'google'].includes(provider)) return json(400, { error: 'Unknown provider.' });

  const user = await getDataUser(email, await getWorkspaceFromRequest(event.headers, email));

  if (provider === 'google') {
    const google = user.accounts.google;
    if (!google || !google.selectedAdAccountId) {
      return json(400, { error: 'Connect a Google Ads account first.' });
    }
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    try {
      const selected90 = { since: fmt(addDays(today, -89)), until: fmt(today) };
      const account = (google.adAccounts || []).find((a) => a.id === google.selectedAdAccountId);
      const actions = await listGoogleConversionActions(
        google,
        google.selectedAdAccountId,
        selected90.since,
        selected90.until,
        { loginCustomerId: account && account.loginCustomerId }
      );

      const groups = GOOGLE_GROUP_LABELS.map((g) => ({ ...g, options: [] }));
      const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
      actions.forEach((a) => {
        const groupId = GOOGLE_CATEGORY_GROUPS[a.category] || 'other';
        byId[groupId].options.push({ id: a.id, label: a.name, count90d: a.count90d });
      });
      groups.forEach((g) => g.options.sort((a, b) => b.count90d - a.count90d));

      // Google action ids are stable resource names - stored selections
      // match literally, no alias canonicalization needed.
      const stored = (google.selectedMetrics || []).map((m) => m.id);
      const offered = new Set(groups.flatMap((g) => g.options.map((o) => o.id)));
      return json(200, {
        available: true,
        provider: 'google',
        groups: groups.filter((g) => g.options.length > 0),
        selected: stored.filter((id) => offered.has(id)),
        hasSavedSelection: Array.isArray(google.selectedMetrics) && google.selectedMetrics.length > 0
      });
    } catch (err) {
      console.error(`[list-metrics] Google conversion actions failed: ${err.message}`);
      return json(502, { error: 'Could not fetch conversion actions from Google Ads. ' + err.message });
    }
  }

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
