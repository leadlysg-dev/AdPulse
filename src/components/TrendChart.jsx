import { useId, useMemo, useState } from 'react';
import './TrendChart.css';

const WIDTH = 560;
const HEIGHT = 240;
const PAD = { top: 20, right: 16, bottom: 28, left: 16 };

function niceMax(max) {
  if (max <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const normalized = max / magnitude;
  let niceNormalized;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

export default function TrendChart({ title, labels, values, color, formatValue = (v) => v }) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState(null);
  const [showTable, setShowTable] = useState(false);

  const { linePath, areaPath, points, yTicks } = useMemo(() => {
    const plotW = WIDTH - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const max = niceMax(Math.max(...values, 1));
    const xStep = values.length > 1 ? plotW / (values.length - 1) : 0;

    const pts = values.map((v, i) => ({
      x: PAD.left + xStep * i,
      y: PAD.top + plotH * (1 - v / max),
      label: labels[i],
      value: v
    }));

    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const area =
      pts.length > 0
        ? `M ${pts[0].x} ${PAD.top + plotH} ` +
          pts.map((p) => `L ${p.x} ${p.y}`).join(' ') +
          ` L ${pts[pts.length - 1].x} ${PAD.top + plotH} Z`
        : '';

    const ticks = [0, 0.5, 1].map((f) => ({
      y: PAD.top + plotH * (1 - f),
      label: formatValue(Math.round(max * f))
    }));

    return { linePath: line, areaPath: area, points: pts, yTicks: ticks };
  }, [values, labels, formatValue]);

  const handleMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const cursorX = (e.clientX - rect.left) * scaleX;
    let nearest = 0;
    let nearestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - cursorX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };

  const last = points[points.length - 1];
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="trend-chart card">
      <div className="trend-chart-head">
        <h3>{title}</h3>
        <button
          type="button"
          className="table-toggle"
          onClick={() => setShowTable((s) => !s)}
          aria-pressed={showTable}
        >
          {showTable ? 'View chart' : 'View as table'}
        </button>
      </div>

      {showTable ? (
        <table className="trend-table">
          <caption className="visually-hidden">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l}>
                <th scope="row">{l}</th>
                <td>{formatValue(values[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="trend-chart-plot">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-label={`${title}: ${labels.map((l, i) => `${l} ${formatValue(values[i])}`).join(', ')}`}
            onPointerMove={handleMove}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.12" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {yTicks.map((t) => (
              <g key={t.y}>
                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={t.y} y2={t.y} className="gridline" />
                <text x={0} y={t.y - 4} className="axis-label">
                  {t.label}
                </text>
              </g>
            ))}

            {hovered && (
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={PAD.top}
                y2={HEIGHT - PAD.bottom}
                className="crosshair"
              />
            )}

            <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
            <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

            {last && (
              <circle cx={last.x} cy={last.y} r="4" fill={color} stroke="var(--surface-1)" strokeWidth="2" />
            )}
            {hovered && hoverIndex !== points.length - 1 && (
              <circle cx={hovered.x} cy={hovered.y} r="4" fill={color} stroke="var(--surface-1)" strokeWidth="2" />
            )}

            {points.map((p, i) => (
              <rect
                key={p.label}
                x={p.x - (WIDTH / points.length) / 2}
                y={PAD.top}
                width={WIDTH / points.length}
                height={HEIGHT - PAD.top - PAD.bottom}
                fill="transparent"
                onFocus={() => setHoverIndex(i)}
                tabIndex={0}
                aria-label={`${p.label}: ${formatValue(p.value)}`}
              />
            ))}

            {last && (
              <text x={last.x} y={last.y - 12} textAnchor="end" className="end-label">
                {formatValue(last.value)}
              </text>
            )}

            {points.map((p, i) => {
              // With daily data there are too many points to label them all -
              // show roughly six, evenly spaced, and skip any that would
              // crowd the final label.
              const step = Math.ceil(points.length / 6);
              const isLast = i === points.length - 1;
              const onStep = i % step === 0 && points.length - 1 - i >= step / 2;
              if (!onStep && !isLast) return null;
              return (
                <text
                  key={p.label}
                  x={p.x}
                  y={HEIGHT - 8}
                  textAnchor={isLast ? 'end' : 'middle'}
                  className="axis-label"
                >
                  {p.label}
                </text>
              );
            })}
          </svg>

          {hovered && (
            <div
              className="trend-tooltip"
              style={{ left: `${(hovered.x / WIDTH) * 100}%` }}
            >
              <span className="trend-tooltip-value">{formatValue(hovered.value)}</span>
              <span className="trend-tooltip-label">{hovered.label}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
