import { useState } from 'react';
import { money } from '../lib/format';
import './KpiCard.css';

// Target status: on track (green) when at/under target, "close" (amber)
// within 15% over, off track (red) beyond that. Color is functional only -
// it always means performance vs the customer's own target.
function goalStatus(costPer, target) {
  if (!target) return null;
  if (!costPer) return { tone: 'neutral', text: 'No results yet' };
  if (costPer <= target) return { tone: 'good', text: 'On track' };
  if (costPer <= target * 1.15) return { tone: 'warn', text: 'Close' };
  return { tone: 'bad', text: 'Off track' };
}

function DeltaLine({ delta }) {
  if (!delta || delta.pct === null || !Number.isFinite(delta.pct) || Math.abs(delta.pct) < 0.5) {
    return null;
  }
  const up = delta.pct > 0;
  const tone = delta.goodWhenUp === null ? 'neutral' : up === delta.goodWhenUp ? 'good' : 'bad';
  return (
    <span className={`kpi-delta kpi-delta-${tone}`}>
      {up ? '↑' : '↓'} {Math.abs(delta.pct).toFixed(0)}%
    </span>
  );
}

export default function KpiCard({
  label,
  valueText,
  delta,
  costPer,
  targetCostPer,
  hero = false,
  selected = false,
  onSelect,
  onSaveGoal, // (targetCostPer|null) => Promise; absent = goal UI hidden
  metricId
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [goalError, setGoalError] = useState('');

  const status = goalStatus(costPer, targetCostPer);

  async function save(value) {
    setSaving(true);
    setGoalError('');
    try {
      await onSaveGoal(value);
      setEditing(false);
    } catch (err) {
      setGoalError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`kpi-card card${hero ? ' kpi-hero' : ''}${selected ? ' kpi-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Show ${label} on the chart`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {status && (
          <span className={`kpi-goal-chip kpi-goal-${status.tone}`}>{status.text}</span>
        )}
      </div>

      <p className="kpi-value">{valueText}</p>

      <div className="kpi-meta">
        <DeltaLine delta={delta} />
        {costPer > 0 && <span className="kpi-costper">{money(costPer)} per result</span>}
      </div>

      {onSaveGoal && !editing && (
        <button
          type="button"
          className="kpi-goal-edit"
          onClick={(e) => {
            e.stopPropagation();
            setDraft(targetCostPer ? String(targetCostPer) : '');
            setGoalError('');
            setEditing(true);
          }}
        >
          {targetCostPer ? `Target: under ${money(targetCostPer)}` : 'Set target'}
        </button>
      )}

      {onSaveGoal && editing && (
        <div className="kpi-goal-form" onClick={(e) => e.stopPropagation()}>
          <label className="visually-hidden" htmlFor={`goal-${metricId}`}>
            Target cost per result
          </label>
          <div className="kpi-goal-row">
            <span className="kpi-goal-prefix">under $</span>
            <input
              id={`goal-${metricId}`}
              type="number"
              min="0.01"
              step="0.01"
              value={draft}
              placeholder="30"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && Number(draft) > 0) save(Number(draft));
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
            />
            <button
              type="button"
              className="btn btn-primary kpi-goal-save"
              disabled={saving || !(Number(draft) > 0)}
              onClick={() => save(Number(draft))}
            >
              Save
            </button>
          </div>
          <div className="kpi-goal-links">
            {targetCostPer != null && (
              <button type="button" className="kpi-goal-link" disabled={saving} onClick={() => save(null)}>
                Remove target
              </button>
            )}
            <button type="button" className="kpi-goal-link" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          {goalError && <p className="kpi-goal-error">{goalError}</p>}
        </div>
      )}
    </div>
  );
}
