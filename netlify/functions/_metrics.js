// Everything about per-customer conversion metrics.
//
// A customer's selection is stored as
// accounts.<provider>.selectedMetrics = [{ id, label, targetCostPer? }],
// where id is a raw Meta action_type (e.g. "lead",
// "offsite_conversion.custom.1234") and label is a friendly-name snapshot.
// Accounts saved before this feature default to Leads at read time.
//
// The picker works from a strict ALLOWLIST catalog: only the canonical
// conversions below are ever offered. Meta reports the same conversion
// under several action-type aliases (omni_purchase already aggregates the
// pixel/app/shop purchase variants), so each canonical lists its aliases in
// priority order - the picker shows one row per canonical, takes the count
// from the highest-priority alias the account actually recorded (never
// summed, which would double-count), and stores that alias's raw id.
// Anything not in the catalog - link clicks, video views, likes, reach,
// content views, and whatever Meta adds next - is excluded by default.

const CONVERSION_CATALOG = [
  // --- Leads & contacts ---
  {
    key: 'leads',
    label: 'Leads',
    group: 'leads_contacts',
    always: true,
    aliases: ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped']
  },
  {
    key: 'contacts',
    label: 'Contacts',
    group: 'leads_contacts',
    always: true,
    aliases: ['contact', 'offsite_conversion.fb_pixel_contact']
  },
  {
    key: 'registrations',
    label: 'Registrations completed',
    group: 'leads_contacts',
    always: true,
    aliases: [
      'complete_registration',
      'offsite_conversion.fb_pixel_complete_registration',
      'omni_complete_registration',
      'app_custom_event.fb_mobile_complete_registration'
    ]
  },
  {
    key: 'applications',
    label: 'Applications submitted',
    group: 'leads_contacts',
    always: false,
    aliases: ['submit_application', 'offsite_conversion.fb_pixel_submit_application']
  },
  {
    key: 'subscriptions',
    label: 'Subscriptions',
    group: 'leads_contacts',
    always: false,
    aliases: ['subscribe', 'offsite_conversion.fb_pixel_subscribe']
  },
  {
    key: 'trials',
    label: 'Trials started',
    group: 'leads_contacts',
    always: false,
    aliases: ['start_trial', 'offsite_conversion.fb_pixel_start_trial', 'app_custom_event.fb_mobile_start_trial']
  },
  {
    // Not a pixel conversion, but Ads Manager counts it as the result of
    // message-objective campaigns - for many local businesses these ARE
    // their leads. Only offered when the account actually records them.
    key: 'messaging_conversations',
    label: 'Messaging conversations started',
    group: 'leads_contacts',
    always: false,
    aliases: ['onsite_conversion.messaging_conversation_started_7d']
  },

  // --- Sales & purchases ---
  {
    key: 'purchases',
    label: 'Purchases',
    group: 'sales',
    always: true,
    aliases: [
      'omni_purchase',
      'purchase',
      'offsite_conversion.fb_pixel_purchase',
      'onsite_conversion.purchase',
      'app_custom_event.fb_mobile_purchase'
    ]
  },
  {
    key: 'checkouts',
    label: 'Checkouts initiated',
    group: 'sales',
    always: true,
    aliases: [
      'omni_initiated_checkout',
      'initiate_checkout',
      'offsite_conversion.fb_pixel_initiate_checkout',
      'app_custom_event.fb_mobile_initiated_checkout'
    ]
  },
  {
    key: 'add_to_cart',
    label: 'Adds to cart',
    group: 'sales',
    always: false,
    aliases: [
      'omni_add_to_cart',
      'add_to_cart',
      'offsite_conversion.fb_pixel_add_to_cart',
      'app_custom_event.fb_mobile_add_to_cart'
    ]
  },
  {
    key: 'payment_info',
    label: 'Payment info added',
    group: 'sales',
    always: false,
    aliases: ['add_payment_info', 'offsite_conversion.fb_pixel_add_payment_info']
  },
  {
    key: 'donations',
    label: 'Donations',
    group: 'sales',
    always: false,
    aliases: ['donate', 'offsite_conversion.fb_pixel_donate']
  },

  // --- Appointments & bookings ---
  {
    key: 'appointments',
    label: 'Appointments scheduled',
    group: 'appointments',
    always: true,
    aliases: ['schedule', 'offsite_conversion.fb_pixel_schedule', 'app_custom_event.fb_mobile_schedule']
  },

  // --- App activity (whole group omitted unless the account has app actions) ---
  {
    key: 'app_installs',
    label: 'App installs',
    group: 'app',
    always: false,
    aliases: ['omni_app_install', 'mobile_app_install', 'app_install']
  }
];

const GROUPS = [
  { id: 'leads_contacts', label: 'Leads & contacts' },
  { id: 'sales', label: 'Sales & purchases' },
  { id: 'appointments', label: 'Appointments & bookings' },
  { id: 'app', label: 'App activity' },
  { id: 'custom', label: 'Your custom conversions' }
];

// alias action_type -> catalog entry
const ALIAS_INDEX = new Map();
CONVERSION_CATALOG.forEach((entry) => {
  entry.aliases.forEach((a) => ALIAS_INDEX.set(a, entry));
});

const DEFAULT_METRICS = [{ id: 'lead', label: 'Leads' }];

// The customer's selection, falling back to Leads for accounts saved before
// this feature existed.
function getSelectedMetrics(providerAccount) {
  const selected = providerAccount && providerAccount.selectedMetrics;
  if (Array.isArray(selected) && selected.length > 0) return selected;
  return DEFAULT_METRICS;
}

// Canonical identity of a stored/raw action type: the catalog key for known
// aliases, the action type itself for custom conversions and anything else.
function canonicalKeyFor(actionType) {
  const entry = ALIAS_INDEX.get(actionType);
  return entry ? entry.key : actionType;
}

// Builds the grouped picker options from what the account actually recorded
// (observedCounts: action_type -> 90-day count) and its custom conversions
// ([{ id, name }]). Groups with no options are omitted entirely.
function buildCatalogGroups(observedCounts, customConversions) {
  const groups = GROUPS.map((g) => ({ id: g.id, label: g.label, options: [] }));
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]));

  CONVERSION_CATALOG.forEach((entry) => {
    const observedAlias = entry.aliases.find((a) => observedCounts[a] > 0);
    if (!observedAlias && !entry.always) return;
    byId[entry.group].options.push({
      id: observedAlias || entry.aliases[0],
      label: entry.label,
      count90d: observedAlias ? observedCounts[observedAlias] : 0
    });
  });

  (customConversions || []).forEach((cc) => {
    const id = `offsite_conversion.custom.${cc.id}`;
    byId.custom.options.push({
      id,
      label: cc.name || 'Custom conversion',
      count90d: observedCounts[id] || 0
    });
  });

  return groups.filter((g) => g.options.length > 0);
}

// Pulls the value of each requested metric out of one insights row's
// actions array.
function extractValues(row, metricIds) {
  const actions = row.actions || [];
  const values = {};
  metricIds.forEach((id) => {
    const action = actions.find((a) => a.action_type === id);
    values[id] = action ? Number(action.value) || 0 : 0;
  });
  return values;
}

module.exports = {
  CONVERSION_CATALOG,
  DEFAULT_METRICS,
  getSelectedMetrics,
  canonicalKeyFor,
  buildCatalogGroups,
  extractValues
};
