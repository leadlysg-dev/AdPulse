import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import './AlertPresets.css';

const singular = (label) => {
  const lower = (label || 'result').toLowerCase();
  return lower.split(' ').length === 1 ? lower.replace(/s$/, '') : lower;
};

// The guided alert templates. Each maps straight onto the alert-rule schema
// and saves instantly - no AI round trip. Metric names come from the
// customer's actual tracked selections.
function buildPresets(metaMetric, googleMetric) {
  const presets = [
    {
      id: 'cpa-above',
      before: `Cost per ${singular(metaMetric.label)} goes above `,
      unit: '$',
      placeholder: '50',
      rule: (v) => ({ metric: 'cpa', channel: 'meta', comparison: 'above', threshold: v, timeframe: 'week' })
    },
    {
      id: 'spend-above',
      before: 'Daily ad spend exceeds ',
      unit: '$',
      placeholder: '100',
      rule: (v) => ({ metric: 'spend', channel: 'all', comparison: 'above', threshold: v, timeframe: 'day' })
    },
    {
      id: 'meta-zero',
      before: `${metaMetric.label} drop to zero for a day`,
      fixed: true,
      rule: () => ({ metric: 'conversions', channel: 'meta', comparison: 'below', threshold: 1, timeframe: 'day' })
    },
    {
      id: 'ctr-below',
      before: 'CTR falls below ',
      unit: '%',
      after: ' this week',
      placeholder: '1',
      rule: (v) => ({ metric: 'ctr', channel: 'all', comparison: 'below', threshold: v, timeframe: 'week' })
    }
  ];
  if (googleMetric) {
    presets.splice(3, 0, {
      id: 'google-zero',
      before: `${googleMetric.label} on Google drop to zero for a day`,
      fixed: true,
      rule: () => ({ metric: 'conversions', channel: 'google', comparison: 'below', threshold: 1, timeframe: 'day' })
    });
  }
  return presets;
}

function PresetRow({ preset, onSaved }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState('idle'); // idle | saving | saved | error
  const numeric = preset.fixed ? 1 : Number(value);
  const valid = preset.fixed || (Number.isFinite(numeric) && numeric > 0);

  async function save() {
    if (!valid || state === 'saving') return;
    setState('saving');
    try {
      await api.createAlert(preset.rule(numeric));
      setState('saved');
      onSaved();
    } catch {
      setState('error');
    }
  }

  return (
    <li className="alert-preset">
      <span className="alert-preset-text">
        {preset.before}
        {!preset.fixed && (
          <span className="alert-preset-input-wrap">
            {preset.unit === '$' && <span className="alert-preset-unit">$</span>}
            <input
              className="alert-preset-input"
              type="number"
              min="0"
              inputMode="decimal"
              placeholder={preset.placeholder}
              value={value}
              aria-label={`${preset.before.trim()} value`}
              onChange={(e) => {
                setValue(e.target.value);
                if (state === 'saved' || state === 'error') setState('idle');
              }}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            {preset.unit === '%' && <span className="alert-preset-unit">%</span>}
          </span>
        )}
        {preset.after || ''}
      </span>
      <button
        type="button"
        className="btn btn-secondary alert-preset-save"
        disabled={!valid || state === 'saving' || state === 'saved'}
        onClick={save}
      >
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : state === 'error' ? 'Retry' : 'Set alert'}
      </button>
    </li>
  );
}

// Guided alert setup: a short list of one-tap templates so nobody faces a
// blank box, with the free-text assistant below for everything custom.
export default function AlertPresets({ metaMetric, googleMetric, onRulesCreated }) {
  const presets = useMemo(
    () => buildPresets(metaMetric || { label: 'Leads' }, googleMetric),
    [metaMetric, googleMetric]
  );

  return (
    <section className="card alert-presets" aria-label="Quick alerts">
      <h2>Quick alerts</h2>
      <p className="alert-presets-sub">
        Pick one, fill in the value, done. For anything else, ask the assistant below in plain English.
      </p>
      <ul className="alert-presets-list">
        {presets.map((p) => (
          <PresetRow key={p.id} preset={p} onSaved={onRulesCreated} />
        ))}
      </ul>
    </section>
  );
}
