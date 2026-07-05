import './DateRangePicker.css';

const RANGES = [
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' }
];

export default function DateRangePicker({ value, onChange }) {
  return (
    <div className="range-picker" role="group" aria-label="Date range">
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          className={`range-picker-option${value === r.value ? ' selected' : ''}`}
          aria-pressed={value === r.value}
          onClick={() => onChange(r.value)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
