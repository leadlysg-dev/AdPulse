import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PLAIN_METRICS, TECH_METRICS, DEFAULT_TRACKED } from '../lib/metrics';

// "What do you want to keep an eye on?" - the tracked-metrics picker, shown
// as onboarding when a workspace hasn't chosen yet and as the "Edit tracked
// metrics" screen from both tabs. Custom pixel/conversion events are listed
// dynamically from what the connected accounts actually fire.
export default function MetricsPicker({ initial, onSaved, onClose, forced }) {
  const [selected, setSelected] = useState(() => new Set(initial?.length ? initial : DEFAULT_TRACKED));
  const [more, setMore] = useState(false);
  const [events, setEvents] = useState(null); // [{id:'event:x', label}]
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // the custom-event list comes from the platforms' own metric discovery
    Promise.all([
      api.listMetrics('meta').catch(() => null),
      api.listMetrics('google').catch(() => null)
    ]).then(([meta, google]) => {
      if (cancelled) return;
      const seen = new Set();
      const list = [];
      for (const r of [meta, google]) {
        for (const m of r?.metrics || []) {
          const id = `event:${m.id}`;
          if (!seen.has(id)) {
            seen.add(id);
            list.push({ id, label: m.label || m.id });
          }
        }
      }
      setEvents(list.slice(0, 40));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id) =>
    setSelected((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const save = async () => {
    if (!selected.size) return setError('Pick at least one.');
    setSaving(true);
    setError('');
    try {
      const metrics = [...selected];
      await api.trackedMetricsSave(metrics);
      const labels = Object.fromEntries((events || []).map((e) => [e.id, e.label]));
      onSaved(metrics, labels);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const Chip = ({ id, label }) => (
    <button type="button" className={`qchip${selected.has(id) ? ' c-cobalt' : ''}`} aria-pressed={selected.has(id)} onClick={() => toggle(id)}>
      {selected.has(id) ? '✓ ' : ''}{label}
    </button>
  );

  return (
    <div className="mp-overlay" role="dialog" aria-label="Tracked metrics">
      <div className="scard mp-card">
        <h2 className="section-title">What do you want to keep an eye on?</h2>
        <p className="section-sub" style={{ marginTop: 4 }}>
          These become your dashboard cards and table columns. Change them any time.
        </p>
        <div className="mp-group">
          {PLAIN_METRICS.map((m) => (
            <Chip key={m.id} id={m.id} label={m.label} />
          ))}
        </div>
        <button type="button" className="sbtn sbtn-ghost sbtn-sm" style={{ marginTop: 12 }} aria-expanded={more} onClick={() => setMore((v) => !v)}>
          More metrics {more ? '▴' : '▾'}
        </button>
        {more && (
          <>
            <div className="mp-group">
              {TECH_METRICS.map((m) => (
                <Chip key={m.id} id={m.id} label={m.label} />
              ))}
            </div>
            <p className="section-sub" style={{ margin: '12px 0 0' }}>From your pixel and conversion tracking:</p>
            <div className="mp-group">
              {events === null && <span className="section-sub">Checking what your accounts fire…</span>}
              {events && events.length === 0 && <span className="section-sub">Connect Meta or Google in Settings to see your custom events here.</span>}
              {(events || []).map((e) => (
                <Chip key={e.id} id={e.id} label={e.label} />
              ))}
            </div>
          </>
        )}
        {error && <p className="section-sub" style={{ color: 'var(--red)', marginTop: 10 }}>{error}</p>}
        <div className="mp-foot">
          {!forced && (
            <button type="button" className="sbtn sbtn-ghost" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="button" className="sbtn sbtn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
