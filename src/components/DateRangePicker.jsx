import { useState } from 'react';
import './DateRangePicker.css';

const RANGES = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' }
];

// The report page's preset lineup (matches the reference layout).
export const REPORT_RANGES = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' },
  { value: 'ytd', label: `YTD ${new Date().getFullYear()}` }
];

const fmt = (d) => d.toISOString().slice(0, 10);
const parse = (s) => new Date(`${s}T00:00:00Z`);
const MONTH_FMT = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY_FMT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// One month's grid: weeks of UTC days, padded with nulls, Monday-first.
function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(Date.UTC(year, month, i + 1)))];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Inline calendar range picker: click a start day, then an end day; the
// range highlights as you go. Same tokens as every other control.
function CalendarRange({ initialSince, initialUntil, onApply, onCancel }) {
  const today = fmt(new Date());
  const [start, setStart] = useState(initialSince || null);
  const [end, setEnd] = useState(initialUntil || null);
  const anchor = parse(start || today);
  const [viewYear, setViewYear] = useState(anchor.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(anchor.getUTCMonth());

  const pick = (iso) => {
    if (!start || (start && end)) {
      setStart(iso);
      setEnd(null);
    } else if (iso < start) {
      setStart(iso);
    } else {
      setEnd(iso);
    }
  };

  const page = (delta) => {
    const d = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  };

  const weeks = monthGrid(viewYear, viewMonth);
  const complete = start && end;
  const summary = start
    ? `${DAY_FMT.format(parse(start))} – ${end ? DAY_FMT.format(parse(end)) : '…'}`
    : 'Pick a start day';

  return (
    <div className="range-cal card" role="dialog" aria-label="Custom date range">
      <div className="range-cal-head">
        <button type="button" className="range-cal-page" aria-label="Previous month" onClick={() => page(-1)}>
          ‹
        </button>
        <span className="range-cal-month">{MONTH_FMT.format(new Date(Date.UTC(viewYear, viewMonth, 1)))}</span>
        <button type="button" className="range-cal-page" aria-label="Next month" onClick={() => page(1)}>
          ›
        </button>
      </div>

      <div className="range-cal-grid" role="grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="range-cal-weekday">{w}</span>
        ))}
        {weeks.flat().map((d, i) => {
          if (!d) return <span key={`pad${i}`} className="range-cal-pad" />;
          const iso = fmt(d);
          const disabled = iso > today;
          const isStart = iso === start;
          const isEnd = iso === end;
          const inRange = start && end && iso > start && iso < end;
          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              aria-pressed={isStart || isEnd}
              className={`range-cal-day${isStart || isEnd ? ' is-edge' : ''}${inRange ? ' is-between' : ''}`}
              onClick={() => pick(iso)}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>

      <div className="range-cal-foot">
        <span className="range-cal-summary" aria-live="polite">{summary}</span>
        <div className="range-cal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!complete}
            onClick={() => onApply({ since: start, until: end })}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// value is a named range string, or { since, until } once a custom window is
// applied. allowCustom adds the Custom option with an inline calendar;
// presets overrides the default range lineup.
export default function DateRangePicker({ value, onChange, allowCustom = false, presets }) {
  const isCustom = typeof value !== 'string';
  const [editingCustom, setEditingCustom] = useState(false);

  return (
    <div className="range-picker-wrap">
      <div className="range-picker" role="group" aria-label="Date range">
        {(presets || RANGES).map((r) => (
          <button
            key={r.value}
            type="button"
            className={`range-picker-option${value === r.value ? ' selected' : ''}`}
            aria-pressed={value === r.value}
            onClick={() => {
              setEditingCustom(false);
              onChange(r.value);
            }}
          >
            {r.label}
          </button>
        ))}
        {allowCustom && (
          <button
            type="button"
            className={`range-picker-option${isCustom || editingCustom ? ' selected' : ''}`}
            aria-pressed={isCustom || editingCustom}
            onClick={() => setEditingCustom((e) => !e)}
          >
            {isCustom ? `${DAY_FMT.format(parse(value.since))} – ${DAY_FMT.format(parse(value.until))}` : 'Custom'}
          </button>
        )}
      </div>

      {allowCustom && editingCustom && (
        <CalendarRange
          initialSince={isCustom ? value.since : null}
          initialUntil={isCustom ? value.until : null}
          onCancel={() => setEditingCustom(false)}
          onApply={(range) => {
            setEditingCustom(false);
            onChange(range);
          }}
        />
      )}
    </div>
  );
}
