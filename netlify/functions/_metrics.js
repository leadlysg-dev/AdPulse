// Everything about per-customer conversion metrics. A customer's selection
// is stored as accounts.<provider>.selectedMetrics = [{ id, label }], where
// id is the raw Meta action_type (e.g. "lead", "purchase",
// "offsite_conversion.custom.1234") and label is a friendly-name snapshot
// taken at selection time. Accounts saved before this feature existed have
// no selectedMetrics - they default to Leads at read time, so nothing needs
// migrating.

// Standard Meta conversion events we always offer in the picker, even when
// the account hasn't recorded them yet (a brand-new account still needs to
// be able to pick what it intends to track).
const STANDARD_EVENTS = [
  { id: 'lead', label: 'Leads' },
  { id: 'purchase', label: 'Purchases' },
  { id: 'schedule', label: 'Appointments scheduled' },
  { id: 'contact', label: 'Contacts' },
  { id: 'complete_registration', label: 'Registrations completed' },
  { id: 'initiate_checkout', label: 'Checkouts initiated' },
  { id: 'app_install', label: 'App installs' },
  { id: 'subscribe', label: 'Subscriptions' }
];

// Extra known action types that only show up when the account has actually
// recorded them.
const KNOWN_LABELS = {
  omni_purchase: 'Purchases (all channels)',
  mobile_app_install: 'Mobile app installs',
  omni_app_install: 'App installs (all channels)',
  omni_initiated_checkout: 'Checkouts initiated (all channels)',
  start_trial: 'Trials started',
  add_to_cart: 'Adds to cart',
  add_payment_info: 'Payment info added',
  submit_application: 'Applications submitted',
  donate: 'Donations'
};

// Engagement noise that has no business meaning as a "conversion" - never
// offered in the picker even though insights reports it.
const IGNORED_ACTION_TYPES = new Set([
  'link_click',
  'page_engagement',
  'post_engagement',
  'landing_page_view',
  'video_view',
  'post_reaction',
  'comment',
  'like',
  'photo_view',
  'post',
  'page_view',
  'onsite_conversion.post_save',
  'onsite_conversion.messaging_first_reply',
  'onsite_conversion.messaging_conversation_started_7d'
]);

const DEFAULT_METRICS = [{ id: 'lead', label: 'Leads' }];

// The customer's selection, falling back to Leads for accounts saved before
// this feature existed.
function getSelectedMetrics(providerAccount) {
  const selected = providerAccount && providerAccount.selectedMetrics;
  if (Array.isArray(selected) && selected.length > 0) return selected;
  return DEFAULT_METRICS;
}

// "offsite_conversion.fb_pixel_custom" -> "Fb pixel custom"
function prettifyActionType(actionType) {
  const known = KNOWN_LABELS[actionType] || STANDARD_EVENTS.find((e) => e.id === actionType)?.label;
  if (known) return known;
  const cleaned = actionType
    .replace(/^offsite_conversion\./, '')
    .replace(/^onsite_conversion\./, '')
    .replace(/^app_custom_event\./, '')
    .replace(/^omni_/, '')
    .replace(/[._]/g, ' ')
    .trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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
  STANDARD_EVENTS,
  IGNORED_ACTION_TYPES,
  DEFAULT_METRICS,
  getSelectedMetrics,
  prettifyActionType,
  extractValues
};
