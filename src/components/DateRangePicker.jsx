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

// value is a named range string, or { since, until } once a custom window is
// applied. allowCustom adds the Custom option with explicit start/end dates;
// presets overrides the default range lineup.
export default function DateRangePicker({ value, onChange, allowCustom = false, presets }) {
  const isCustom = typeof value !== 'string';
  const [editingCustom, setEditingCustom] = useState(false);
  const [since, setSince] = useState(isCustom ? value.since : '');
  const [until, setUntil] = useState(isCustom ? value.until : '');

  const today = new Date().toISOString().slice(0, 10);
  const customValid = since && until && since <= until && until <= today;

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
            onClick={() => setEditingCustom(true)}
          >
            Custom
          </button>
        )}
      </div>

      {allowCustom && (editingCustom || isCustom) && (
        <form
          className="range-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (!customValid) return;
            setEditingCustom(false);
            onChange({ since, until });
          }}
        >
          <label htmlFor="range-since" className="visually-hidden">Start date</label>
          <input
            id="range-since"
            type="date"
            max={until || today}
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
          <span className="range-custom-sep" aria-hidden="true">–</span>
          <label htmlFor="range-until" className="visually-hidden">End date</label>
          <input
            id="range-until"
            type="date"
            min={since || undefined}
            max={today}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
          <button type="submit" className="btn btn-secondary range-custom-apply" disabled={!customValid}>
            Apply
          </button>
        </form>
      )}
    </div>
  );
}
