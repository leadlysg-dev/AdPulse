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

/* ── The six fixed diagrams' building blocks ─────────────────────── */

const sgd = (v) => 'S$' + (v || 0).toLocaleString('en-SG', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });

// Spend (area, left axis) vs results (line, right axis), each on its own
// scale; the previous period rides as muted dashed lines when compare is on.
export function DualTrend({ data }) {
  const W = 860;
  const H = 190;
  const pad = 24;
  const spendMax = Math.max(...data.spend, ...(data.prevSpend || []), 1);
  const resMax = Math.max(...data.results, ...(data.prevResults || []), 1);
  const x = (i, len) => (len > 1 ? (i / (len - 1)) * W : 0);
  const yS = (v) => H - pad - (v / spendMax) * (H - pad * 2);
  const yR = (v) => H - pad - (v / resMax) * (H - pad * 2);
  const line = (values, y) => values.map((v, i) => `${x(i, values.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ch-trend" preserveAspectRatio="none" aria-hidden="true">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H - pad - f * (H - pad * 2)} y2={H - pad - f * (H - pad * 2)} className="grid-l" />
        ))}
        <polygon fill="var(--cobalt-soft)" points={`${line(data.spend, yS)} ${W},${H - pad} 0,${H - pad}`} />
        <polyline fill="none" stroke="var(--cobalt)" strokeWidth="2" strokeLinejoin="round" points={line(data.spend, yS)} />
        {data.prevSpend && data.prevSpend.length > 1 && (
          <polyline fill="none" stroke="var(--cobalt)" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="5 4" points={line(data.prevSpend, yS)} />
        )}
        <polyline fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinejoin="round" points={line(data.results, yR)} />
        {data.prevResults && data.prevResults.length > 1 && (
          <polyline fill="none" stroke="var(--green)" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="5 4" points={line(data.prevResults, yR)} />
        )}
        <text className="axis" x="0" y={H - 6}>{data.labels[0]}</text>
        <text className="axis" x={W - 52} y={H - 6}>{data.labels[data.labels.length - 1]}</text>
        <text className="axis" x="0" y="12">{sgd(spendMax)}</text>
        <text className="axis" x={W - 52} y="12" textAnchor="start">{Math.round(resMax)}</text>
      </svg>
      <div className="legend" style={{ marginTop: 6 }}>
        <span><i style={{ background: 'var(--cobalt)' }} />Spend (left)</span>
        <span><i style={{ background: 'var(--green)' }} />{data.resultLabel} (right)</span>
        {data.prevSpend && <span><i style={{ background: 'var(--ink-faint)' }} />Previous period (dashed)</span>}
      </div>
    </div>
  );
}

// Cost-per-result line with a "typical range" band; points outside the band
// glow amber, and red when they run well past it.
export function BandTrend({ data }) {
  const W = 560;
  const H = 170;
  const pad = 22;
  const vals = data.values.map((v) => (v == null ? null : v));
  const present = vals.filter((v) => v != null);
  const hiBound = Math.max(...present, data.band ? data.band.hi : 0, 1);
  const y = (v) => H - pad - (v / hiBound) * (H - pad * 2);
  const x = (i) => (vals.length > 1 ? (i / (vals.length - 1)) * W : 0);
  const pts = vals.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ch-trend" preserveAspectRatio="none" aria-hidden="true">
        {data.band && (
          <rect x="0" width={W} y={y(data.band.hi)} height={Math.max(2, y(data.band.lo) - y(data.band.hi))} fill="var(--green-soft)" opacity="0.55" />
        )}
        {[0.5].map((f) => (
          <line key={f} x1="0" x2={W} y1={H - pad - f * (H - pad * 2)} y2={H - pad - f * (H - pad * 2)} className="grid-l" />
        ))}
        <polyline fill="none" stroke="var(--cobalt)" strokeWidth="2.5" strokeLinejoin="round" points={pts.join(' ')} />
        {data.band &&
          vals.map((v, i) => {
            if (v == null || (v >= data.band.lo && v <= data.band.hi)) return null;
            const far = v > data.band.hi * 1.35 || v < data.band.lo * 0.65;
            return <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={far ? 'var(--red)' : 'var(--amber)'} />;
          })}
        <text className="axis" x="0" y={H - 4}>{data.labels[0]}</text>
        <text className="axis" x={W - 46} y={H - 4}>{data.labels[data.labels.length - 1]}</text>
        <text className="axis" x="0" y="12">{sgd(hiBound)}</text>
      </svg>
      {data.band && (
        <div className="legend" style={{ marginTop: 6 }}>
          <span><i style={{ background: 'var(--green-soft)' }} />Typical range ({sgd(data.band.lo)}–{sgd(data.band.hi)})</span>
          <span><i style={{ background: 'var(--amber)' }} />Outside it</span>
        </div>
      )}
    </div>
  );
}

// Meta vs Google: share of spend against share of results, paired
// horizontal bars per platform.
export function SharePairs({ data }) {
  return (
    <div className="ch-pairs">
      {data.rows.map((r) => (
        <div key={r.label} className="ch-pair">
          <span className="ch-pair-name"><span className={`dot ${r.dot}`} />{r.label}</span>
          {[['Spend', r.spendShare], [data.resultLabel, r.resultShare]].map(([lbl, share], i) => (
            <div key={lbl} className="ch-pair-row">
              <span className="ch-pair-lbl">{lbl}</span>
              <div className="ch-funnel-track">
                <div className="ch-funnel-bar" style={{ width: `${Math.max(2, share * 100)}%`, background: i === 0 ? 'var(--ink-faint)' : r.color }} />
              </div>
              <span className="ch-pair-val">{Math.round(share * 100)}%</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Campaigns ranked by cost per result, best first, green fading to red.
export function Leaderboard({ data }) {
  const max = Math.max(...data.rows.map((r) => r.costPer), 1);
  const color = (i, n) => {
    const t = n > 1 ? i / (n - 1) : 0;
    return t < 0.34 ? 'var(--green)' : t < 0.67 ? 'var(--amber)' : 'var(--red)';
  };
  return (
    <div className="ch-funnel">
      {data.rows.map((r, i) => (
        <div className="ch-funnel-row" key={r.name}>
          <span className="ch-funnel-label" title={r.name}>{r.name}</span>
          <div className="ch-funnel-track">
            <div className="ch-funnel-bar" style={{ width: `${Math.max(3, (r.costPer / max) * 100)}%`, background: color(i, data.rows.length) }} />
          </div>
          <span className="ch-funnel-val">{sgd(r.costPer)}</span>
          <span className="ch-funnel-drop">{r.results % 1 ? r.results.toFixed(1) : r.results} {data.unit}</span>
        </div>
      ))}
    </div>
  );
}

// Day-of-week × hour-of-day heat grid of when results arrive.
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function Heatmap({ data }) {
  const max = Math.max(...data.cells.flat(), 1);
  return (
    <div className="ch-heat">
      <div className="ch-heat-grid">
        {data.cells.map((row, d) => (
          <div className="ch-heat-row" key={d}>
            <span className="ch-heat-dow">{DOW_LABELS[d]}</span>
            {row.map((v, h) => (
              <span
                key={h}
                className="ch-heat-cell"
                title={`${DOW_LABELS[d]} ${h}:00 — ${v % 1 ? v.toFixed(1) : v}`}
                style={{ background: v > 0 ? `rgba(36,71,245,${0.12 + 0.78 * (v / max)})` : 'var(--line-soft)' }}
              />
            ))}
          </div>
        ))}
        <div className="ch-heat-row ch-heat-hours">
          <span className="ch-heat-dow" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="ch-heat-cell ch-heat-hour">{h % 6 === 0 ? (h === 0 ? '12a' : h === 12 ? '12p' : h % 12 + (h < 12 ? 'a' : 'p')) : ''}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const CHARTS = { funnel: Funnel, trend: Trend, bars: Bars, donut: Donut, callout: Callout };
