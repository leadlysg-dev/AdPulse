import { useEffect, useRef, useState } from 'react';

// The shared date selector: preset chips + a Custom two-month calendar
// popover + the "vs previous period" compare toggle. Lives directly below
// each tab's platform control and drives everything on that tab.
// value: { key, label, since?, until? } - named preset keys map straight to
// the backend's range presets; custom carries since/until.
export const DATE_PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'last_7d', label: 'Last 7 days' },
  { key: 'last_30d', label: 'Last 30 days' },
  { key: 'this_month', label: 'This month' }
];

const iso = (d) => d.toISOString().slice(0, 10);
const todayIso = () => iso(new Date());

// A preset becomes the api view value: named ranges pass through, "today"
// and custom become {since, until}.
export function toView(value) {
  if (value.key === 'today') return { since: todayIso(), until: todayIso() };
  if (value.key === 'custom') return { since: value.since, until: value.until };
  return value.key;
}

function Month({ year, month, start, end, onPick }) {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const name = first.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className="cal-month">
      <div className="cal-name">{name}</div>
      <div className="cal-grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <span key={i} className="cal-dow">{d}</span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const dateIso = iso(new Date(Date.UTC(year, month, d)));
          const sel = dateIso === start || dateIso === end;
          const inRange = start && end && dateIso > start && dateIso < end;
          return (
            <button
              key={i}
              type="button"
              className={`cal-day${sel ? ' sel' : ''}${inRange ? ' mid' : ''}`}
              onClick={() => onPick(dateIso)}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DateSelector({ value, onChange, compare, onCompare }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(value.since || null);
  const [end, setEnd] = useState(value.until || null);
  const [anchor, setAnchor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() - 1 };
  });
  const wrapRef = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (dateIso) => {
    if (!start || (start && end)) {
      setStart(dateIso);
      setEnd(null);
      return;
    }
    const [a, b] = dateIso < start ? [dateIso, start] : [start, dateIso];
    setStart(a);
    setEnd(b);
  };

  const apply = () => {
    if (!start) return;
    const until = end || start;
    onChange({ key: 'custom', label: `${start} → ${until}`, since: start, until });
    setOpen(false);
  };

  const fmt = (s) =>
    new Date(s + 'T00:00:00Z').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="date-selector" ref={wrapRef}>
      {DATE_PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          className={`sbtn sbtn-ghost sbtn-sm${value.key === p.key ? ' on-dark' : ''}`}
          aria-pressed={value.key === p.key}
          onClick={() => {
            setOpen(false);
            onChange({ key: p.key, label: p.label });
          }}
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        className={`sbtn sbtn-ghost sbtn-sm${value.key === 'custom' ? ' on-dark' : ''}`}
        aria-pressed={value.key === 'custom'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {value.key === 'custom' ? `${fmt(value.since)} – ${fmt(value.until)}` : 'Custom'}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      <button
        type="button"
        className={`sbtn sbtn-ghost sbtn-sm compare-toggle${compare ? ' on-dark' : ''}`}
        aria-pressed={compare}
        onClick={() => onCompare(!compare)}
        title="Show change vs the previous period"
      >
        vs previous period
      </button>

      {open && (
        <div className="cal-pop scard" role="dialog" aria-label="Custom date range">
          <div className="cal-nav">
            <button type="button" className="sbtn sbtn-ghost sbtn-sm" onClick={() => setAnchor((a) => ({ y: a.m === 0 ? a.y - 1 : a.y, m: a.m === 0 ? 11 : a.m - 1 }))}>
              ←
            </button>
            <button type="button" className="sbtn sbtn-ghost sbtn-sm" onClick={() => setAnchor((a) => ({ y: a.m === 11 ? a.y + 1 : a.y, m: a.m === 11 ? 0 : a.m + 1 }))}>
              →
            </button>
          </div>
          <div className="cal-months">
            <Month year={anchor.y} month={anchor.m} start={start} end={end} onPick={pick} />
            <Month year={anchor.m === 11 ? anchor.y + 1 : anchor.y} month={(anchor.m + 1) % 12} start={start} end={end} onPick={pick} />
          </div>
          <div className="cal-foot">
            <span className="section-sub">{start ? `${fmt(start)}${end ? ` – ${fmt(end)}` : ' – pick an end date'}` : 'Pick a start date'}</span>
            <button type="button" className="sbtn sbtn-primary sbtn-sm" disabled={!start} onClick={apply}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
