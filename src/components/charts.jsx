// The chart component library the AI composes from: funnel, trend, grouped
// bars, donut, and stat callout. All colours come from the spec tokens.
// Each takes the exact data schema pulse-analytics validates.
const PALETTE = ['var(--cobalt)', 'var(--green)', 'var(--amber)', '#6B32AD', 'var(--meta)', 'var(--ink-faint)'];

export function Funnel({ data }) {
  const max = Math.max(...data.stages.map((s) => s.value), 1);
  return (
    <div className="ch-funnel">
      {data.stages.map((s, i) => {
        const prev = i > 0 ? data.stages[i - 1].value : null;
        const drop = prev > 0 ? Math.round((1 - s.value / prev) * 100) : null;
        return (
          <div className="ch-funnel-row" key={s.label}>
            <span className="ch-funnel-label">{s.label}</span>
            <div className="ch-funnel-track">
              <div className="ch-funnel-bar" style={{ width: `${Math.max(2, (s.value / max) * 100)}%` }} />
            </div>
            <span className="ch-funnel-val">{s.value.toLocaleString()}</span>
            <span className="ch-funnel-drop">{drop !== null && drop > 0 ? `−${drop}%` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Trend({ data }) {
  const W = 560;
  const H = 150;
  const all = data.series.flatMap((s) => s.values);
  const max = Math.max(...all, 1);
  const pts = (values) =>
    values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * W).toFixed(1)},${(H - 18 - (v / max) * (H - 34)).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ch-trend" preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H - 18 - f * (H - 34)} y2={H - 18 - f * (H - 34)} className="grid-l" />
        ))}
        {data.series.map((s, i) => (
          <g key={s.label}>
            {i === 0 && <polygon fill="var(--cobalt-soft)" points={`${pts(s.values)} ${W},${H - 18} 0,${H - 18}`} />}
            <polyline fill="none" stroke={PALETTE[i]} strokeWidth="2.5" strokeLinejoin="round" points={pts(s.values)} />
          </g>
        ))}
        <text className="axis" x="0" y={H - 4}>{data.labels[0]}</text>
        <text className="axis" x={W - 46} y={H - 4}>{data.labels[data.labels.length - 1]}</text>
      </svg>
      <div className="legend" style={{ marginTop: 6 }}>
        {data.series.map((s, i) => (
          <span key={s.label}>
            <i style={{ background: PALETTE[i] }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Bars({ data }) {
  const max = Math.max(...data.groups.flatMap((g) => g.values), 1);
  return (
    <div>
      <div className="ch-bars">
        {data.groups.map((g) => (
          <div className="ch-bar-group" key={g.label}>
            <div className="ch-bar-set">
              {g.values.map((v, i) => (
                <div key={i} className="ch-bar" style={{ height: `${Math.max(3, (v / max) * 100)}%`, background: PALETTE[i] }} title={`${data.series[i]}: ${v.toLocaleString()}`} />
              ))}
            </div>
            <span className="ch-bar-label" title={g.label}>{g.label}</span>
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        {data.series.map((s, i) => (
          <span key={s}>
            <i style={{ background: PALETTE[i] }} />
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Donut({ data }) {
  const total = data.slices.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0;
  const R = 54;
  const C = 2 * Math.PI * R;
  return (
    <div className="ch-donut">
      <svg viewBox="0 0 140 140" width="140" height="140" aria-hidden="true">
        {data.slices.map((s, i) => {
          const frac = s.value / total;
          const dash = `${frac * C} ${C}`;
          const off = -acc * C;
          acc += frac;
          return (
            <circle key={s.label} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i]} strokeWidth="20" strokeDasharray={dash} strokeDashoffset={off} transform="rotate(-90 70 70)" />
          );
        })}
      </svg>
      <div className="ch-donut-legend">
        {data.slices.map((s, i) => (
          <div key={s.label} className="ch-donut-item">
            <i style={{ background: PALETTE[i] }} />
            <span className="ch-donut-label">{s.label}</span>
            <b>{Math.round((s.value / total) * 100)}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Callout({ data }) {
  return (
    <div className="ch-callout">
      <span className="ch-callout-value">{data.value}</span>
      <span className="ch-callout-label">{data.label}</span>
      {data.detail && <span className="section-sub">{data.detail}</span>}
    </div>
  );
}

export const CHARTS = { funnel: Funnel, trend: Trend, bars: Bars, donut: Donut, callout: Callout };
