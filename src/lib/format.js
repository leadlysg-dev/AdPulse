export const money = (v) => {
  const n = Number(v || 0);
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
};

export const number = (v) => Number(v || 0).toLocaleString();

const shortDate = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});

// "2026-06-12" -> "Jun 12"
export const fmtDate = (iso) => shortDate.format(new Date(`${iso}T00:00:00Z`));

// Percentage change vs a prior value; null when there's no meaningful base.
export const pctChange = (current, previous) => {
  if (!previous || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
};

// Fixed color assignment for the customer's tracked metrics, by selection
// order (stable - a metric keeps its color as long as the selection keeps
// its order). Spend always wears --series-8 (orange), which is why it's
// absent here.
const METRIC_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-5)',
  'var(--series-4)',
  'var(--series-7)',
  'var(--series-6)',
  'var(--series-3)'
];

export const metricColor = (index) => METRIC_COLORS[index] || 'var(--text-muted)';
