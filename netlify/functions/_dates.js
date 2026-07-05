// Turns a named range ("last_7d", "last_30d", "this_month", "last_month")
// into explicit since/until dates, plus the equivalent prior period so the
// dashboard can show "vs previous period" comparisons. All dates are UTC
// calendar days formatted YYYY-MM-DD, which is what Meta's time_range wants.

const VALID_RANGES = ['last_7d', 'last_30d', 'this_month', 'last_month'];

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

function resolveRange(range) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (range === 'this_month') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    // Prior period = the same number of elapsed days at the start of last month,
    // capped at last month's length (e.g. on May 31 the prior window in April
    // ends on the 30th).
    const daysElapsed = today.getUTCDate();
    const prevStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const prevMonthDays = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).getUTCDate();
    const prevEnd = addDays(prevStart, Math.min(daysElapsed, prevMonthDays) - 1);
    return { since: fmt(start), until: fmt(today), prevSince: fmt(prevStart), prevUntil: fmt(prevEnd) };
  }

  if (range === 'last_month') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    const prevStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));
    const prevEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 0));
    return { since: fmt(start), until: fmt(end), prevSince: fmt(prevStart), prevUntil: fmt(prevEnd) };
  }

  const days = range === 'last_7d' ? 7 : 30;
  const since = addDays(today, -(days - 1));
  const prevUntil = addDays(since, -1);
  const prevSince = addDays(prevUntil, -(days - 1));
  return { since: fmt(since), until: fmt(today), prevSince: fmt(prevSince), prevUntil: fmt(prevUntil) };
}

// Every calendar day between since and until inclusive, as YYYY-MM-DD strings.
function listDays(since, until) {
  const days = [];
  let d = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (d <= end) {
    days.push(fmt(d));
    d = addDays(d, 1);
  }
  return days;
}

module.exports = { VALID_RANGES, resolveRange, listDays, fmt, addDays };
