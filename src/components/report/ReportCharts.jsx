// The report's chart set: stacked daily spend by campaign type, a spend
// allocation donut, and the leads/cost-per pair. One axis per plot - the
// leads + CPL view is two stacked panels sharing an x-axis, never a
// dual-axis chart. Identity is never color-alone: every multi-series plot
// has a legend and a table view.
import { useMemo, useState } from 'react';
import './ReportCharts.css';

const W = 560;

function niceMax(max) {
  if (max <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

// Roughly six x labels, evenly spaced, last one always shown.
function xLabelVisible(i, count) {
  const step = Math.ceil(count / 6);
  const isLast = i === count - 1;
  return isLast || (i % step === 0 && count - 1 - i >= step / 2);
}

function useNearestIndex(count, plotLeft, plotWidth, viewWidth = W) {
  const [index, setIndex] = useState(null);
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * viewWidth;
    const slot = Math.round(((x - plotLeft) / plotWidth) * (count - 1));
    setIndex(Math.max(0, Math.min(count - 1, slot)));
  };
  return { index, setIndex, onMove };
}

function ChartShell({ title, subtitle, legend, table, children }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="card report-chart">
      <div className="report-chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="report-chart-sub">{subtitle}</p>}
        </div>
        <button type="button" className="table-toggle" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
          {showTable ? 'View chart' : 'View as table'}
        </button>
      </div>
      {showTable ? table : children}
      {!showTable && legend && (
        <div className="report-legend">
          {legend.map((l) => (
            <span key={l.label} className="report-legend-item">
              <span className={`report-legend-swatch${l.dashed ? ' dashed' : ''}`} style={{ background: l.dashed ? 'transparent' : l.color, borderColor: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DataTable({ title, columns, rows }) {
  return (
    <table className="report-data-table">
      <caption className="visually-hidden">{title}</caption>
      <thead>
        <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <th scope="row">{r[0]}</th>
            {r.slice(1).map((v, j) => <td key={j}>{v}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Stacked daily bars, one segment per series, 2px surface gaps between
// segments and a 4px rounded cap on the stack top.
export function StackedBarChart({ title, subtitle, labels, series, formatValue }) {
  const H = 220;
  const PAD = { top: 12, right: 8, bottom: 24, left: 40 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const n = labels.length;
  const { index, setIndex, onMove } = useNearestIndex(n, PAD.left, plotW);

  const max = niceMax(Math.max(1, ...labels.map((_, i) => series.reduce((a, s) => a + s.values[i], 0))));
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(28, slot * 0.6));

  const table = (
    <DataTable
      title={title}
      columns={['Day', ...series.map((s) => s.label)]}
      rows={labels.map((l, i) => [l, ...series.map((s) => formatValue(s.values[i]))])}
    />
  );

  return (
    <ChartShell title={title} subtitle={subtitle} legend={series.map((s) => ({ label: s.label, color: s.color }))} table={table}>
      <div className="report-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => setIndex(null)}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH * (1 - f)} y2={PAD.top + plotH * (1 - f)} className="report-gridline" />
              <text x={PAD.left - 6} y={PAD.top + plotH * (1 - f) + 3} textAnchor="end" className="report-axis-label">
                {formatValue(+(max * f).toFixed(2))}
              </text>
            </g>
          ))}
          {labels.map((l, i) => {
            const x = PAD.left + slot * i + (slot - barW) / 2;
            let yCursor = PAD.top + plotH;
            const segs = series.map((s) => {
              const h = (s.values[i] / max) * plotH;
              yCursor -= h;
              return { color: s.color, y: yCursor, h };
            });
            const top = segs.filter((s) => s.h > 0).slice(-1)[0];
            return (
              <g key={l} opacity={index === null || index === i ? 1 : 0.45}>
                {segs.map((s, j) =>
                  s.h <= 0 ? null : (
                    <rect
                      key={j}
                      x={x}
                      y={s.y + (s === top ? 0 : 0)}
                      width={barW}
                      height={Math.max(1, s.h - (s === top ? 0 : 2))}
                      rx={s === top ? 4 : 0}
                      fill={s.color}
                    />
                  )
                )}
              </g>
            );
          })}
          {labels.map((l, i) =>
            xLabelVisible(i, n) ? (
              <text key={l} x={PAD.left + slot * i + slot / 2} y={H - 6} textAnchor="middle" className="report-axis-label">
                {l}
              </text>
            ) : null
          )}
        </svg>
        {index !== null && (
          <div className="report-tooltip" style={{ left: `${((PAD.left + slot * index + slot / 2) / W) * 100}%` }}>
            <span className="report-tooltip-label">{labels[index]}</span>
            {series.map((s) => (
              <span key={s.label} className="report-tooltip-row">
                <span className="report-legend-swatch" style={{ background: s.color }} />
                {s.label}: {formatValue(s.values[index])}
              </span>
            ))}
          </div>
        )}
      </div>
    </ChartShell>
  );
}

// Part-to-whole donut with 2px surface gaps and direct labels in the legend.
export function DonutChart({ title, subtitle, segments, formatValue }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const R = 70;
  const STROKE = 34;
  const C = 2 * Math.PI * R;
  let offset = 0;

  const table = (
    <DataTable
      title={title}
      columns={['Segment', 'Value', 'Share']}
      rows={segments.map((s) => [s.label, formatValue(s.value), total > 0 ? `${((s.value / total) * 100).toFixed(0)}%` : '—'])}
    />
  );

  return (
    <ChartShell title={title} subtitle={subtitle} table={table}>
      <div className="report-donut-wrap">
        <svg viewBox="0 0 200 200" role="img" aria-label={title}>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--gridline)" strokeWidth={STROKE} opacity="0.4" />
          {total > 0 &&
            segments.map((s) => {
              const frac = s.value / total;
              const gap = segments.filter((x) => x.value > 0).length > 1 ? 2 : 0;
              const dash = Math.max(0, frac * C - gap);
              const el = (
                <circle
                  key={s.label}
                  cx="100"
                  cy="100"
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 100 100)"
                >
                  <title>{`${s.label}: ${formatValue(s.value)}`}</title>
                </circle>
              );
              offset += frac * C;
              return el;
            })}
        </svg>
        <div className="report-donut-legend">
          {segments.map((s) => (
            <div key={s.label} className="report-donut-legend-row">
              <span className="report-legend-swatch" style={{ background: s.color }} />
              <span className="report-donut-legend-label">{s.label}</span>
              <span className="report-donut-legend-value">
                {formatValue(s.value)}
                {total > 0 ? ` · ${((s.value / total) * 100).toFixed(0)}%` : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </ChartShell>
  );
}

// Results per day (bars) over cost-per-result per day (line + dashed target),
// as two stacked panels sharing one x-axis - one scale per panel.
export function PairedTrendChart({ title, subtitle, labels, bars, line, target, formatBar, formatLine }) {
  // Rendered full-width, so it gets a wider coordinate space than the
  // half-width charts - otherwise its text scales up ~2x.
  const PW = 1000;
  const TOP_H = 130;
  const BOT_H = 110;
  const H = TOP_H + BOT_H + 24;
  const PAD = { right: 8, left: 44 };
  const plotW = PW - PAD.left - PAD.right;
  const n = labels.length;
  const { index, setIndex, onMove } = useNearestIndex(n, PAD.left, plotW, PW);

  const barMax = niceMax(Math.max(1, ...bars.values));
  const lineMax = niceMax(Math.max(1, ...line.values.filter((v) => v != null), target || 0));
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(28, slot * 0.6));
  const lineY = (v) => TOP_H + 18 + (BOT_H - 26) * (1 - v / lineMax);
  const linePts = line.values
    .map((v, i) => (v == null ? null : { x: PAD.left + slot * i + slot / 2, y: lineY(v), i }))
    .filter(Boolean);
  const linePath = linePts.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  const table = (
    <DataTable
      title={title}
      columns={['Day', bars.label, line.label]}
      rows={labels.map((l, i) => [l, formatBar(bars.values[i]), line.values[i] == null ? '—' : formatLine(line.values[i])])}
    />
  );

  const legend = [
    { label: bars.label, color: bars.color },
    { label: line.label, color: line.color },
    ...(target ? [{ label: `Target ${formatLine(target)}`, color: 'var(--text-muted)', dashed: true }] : [])
  ];

  return (
    <ChartShell title={title} subtitle={subtitle} legend={legend} table={table}>
      <div className="report-plot">
        <svg viewBox={`0 0 ${PW} ${H}`} role="img" aria-label={title} onPointerMove={onMove} onPointerLeave={() => setIndex(null)}>
          {/* top panel: bars */}
          {[0, 1].map((f) => (
            <g key={`b${f}`}>
              <line x1={PAD.left} x2={PW - PAD.right} y1={10 + (TOP_H - 14) * (1 - f)} y2={10 + (TOP_H - 14) * (1 - f)} className="report-gridline" />
              <text x={PAD.left - 6} y={10 + (TOP_H - 14) * (1 - f) + 3} textAnchor="end" className="report-axis-label">
                {formatBar(+(barMax * f).toFixed(1))}
              </text>
            </g>
          ))}
          {bars.values.map((v, i) => {
            const h = (v / barMax) * (TOP_H - 14);
            return h <= 0 ? null : (
              <rect
                key={i}
                x={PAD.left + slot * i + (slot - barW) / 2}
                y={10 + (TOP_H - 14) - h}
                width={barW}
                height={h}
                rx="4"
                fill={bars.color}
                opacity={index === null || index === i ? 1 : 0.45}
              />
            );
          })}
          {/* bottom panel: line + target */}
          {[0, 1].map((f) => (
            <g key={`l${f}`}>
              <line x1={PAD.left} x2={PW - PAD.right} y1={lineY(lineMax * f)} y2={lineY(lineMax * f)} className="report-gridline" />
              <text x={PAD.left - 6} y={lineY(lineMax * f) + 3} textAnchor="end" className="report-axis-label">
                {formatLine(+(lineMax * f).toFixed(2))}
              </text>
            </g>
          ))}
          {target > 0 && (
            <line x1={PAD.left} x2={PW - PAD.right} y1={lineY(target)} y2={lineY(target)} className="report-target-line" />
          )}
          <path d={linePath} fill="none" stroke={line.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {linePts.slice(-1).map((p) => (
            <circle key="end" cx={p.x} cy={p.y} r="4" fill={line.color} stroke="var(--surface-2)" strokeWidth="2" />
          ))}
          {index !== null && (
            <line x1={PAD.left + slot * index + slot / 2} x2={PAD.left + slot * index + slot / 2} y1={10} y2={H - 20} className="report-crosshair" />
          )}
          {labels.map((l, i) =>
            xLabelVisible(i, n) ? (
              <text key={l} x={PAD.left + slot * i + slot / 2} y={H - 4} textAnchor="middle" className="report-axis-label">
                {l}
              </text>
            ) : null
          )}
        </svg>
        {index !== null && (
          <div className="report-tooltip" style={{ left: `${((PAD.left + slot * index + slot / 2) / PW) * 100}%` }}>
            <span className="report-tooltip-label">{labels[index]}</span>
            <span className="report-tooltip-row">
              <span className="report-legend-swatch" style={{ background: bars.color }} />
              {bars.label}: {formatBar(bars.values[index])}
            </span>
            <span className="report-tooltip-row">
              <span className="report-legend-swatch" style={{ background: line.color }} />
              {line.label}: {line.values[index] == null ? '—' : formatLine(line.values[index])}
            </span>
          </div>
        )}
      </div>
    </ChartShell>
  );
}

// Tiny inline trend for the summary tiles; the tile's own text carries the
// numbers, so this is decorative and hidden from readers.
export function Spark({ values, color }) {
  const path = useMemo(() => {
    const w = 120;
    const h = 34;
    const max = Math.max(1, ...values);
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    const pts = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${2 + (h - 4) * (1 - v / max)}`);
    return { line: pts.join(' '), area: `${pts.join(' ')} L ${w} ${h} L 0 ${h} Z` };
  }, [values]);
  return (
    <svg viewBox="0 0 120 34" className="report-spark" aria-hidden="true" preserveAspectRatio="none">
      <path d={path.area} fill={color} opacity="0.10" stroke="none" />
      <path d={path.line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
