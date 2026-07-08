// Shared alert-rule vocabulary: the assistant's tool and the preset
// endpoint both save through this, so a rule reads identically everywhere.
const METRIC_LABELS = { cpa: 'CPA', roas: 'ROAS', spend: 'ad spend', ctr: 'CTR', conversions: 'conversions' };
const CHANNEL_LABELS = { meta: 'Meta', google: 'Google', all: 'combined' };

function formatThreshold(metric, value) {
  if (metric === 'cpa' || metric === 'spend') {
    return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }
  if (metric === 'roas') return `${value}x`;
  if (metric === 'ctr') return `${value}%`;
  return `${Number(value).toLocaleString()}`;
}

// "Meta CPA falls below $10 in a day" - the single source of truth for how a
// rule reads, used for the saved description and the chat confirmation.
function describeRule(rule) {
  const verb = rule.comparison === 'below' ? 'falls below' : 'goes above';
  return `${CHANNEL_LABELS[rule.channel]} ${METRIC_LABELS[rule.metric]} ${verb} ${formatThreshold(rule.metric, rule.threshold)} in a ${rule.timeframe}`;
}

function validRule(input) {
  return (
    input &&
    ['cpa', 'roas', 'spend', 'ctr', 'conversions'].includes(input.metric) &&
    ['meta', 'google', 'all'].includes(input.channel) &&
    ['below', 'above'].includes(input.comparison) &&
    ['day', 'week', 'month'].includes(input.timeframe) &&
    Number.isFinite(input.threshold) &&
    input.threshold > 0 &&
    input.threshold < 1e9
  );
}

module.exports = { METRIC_LABELS, CHANNEL_LABELS, formatThreshold, describeRule, validRule };
