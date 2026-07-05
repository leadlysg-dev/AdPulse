import { useState } from 'react';
import { fmtDate } from '../lib/format';
import './WeeklyBars.css';

const WIDTH = 560;
const HEIGHT = 200;
const PAD = { top: 18, right: 8, bottom: 26, left: 8 };
const MAX_BAR = 24;
const GAP = 2;

function niceMax(max) {
  if (max <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const normalized = max / magnitude;
  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

// Rounded top corners, square at the baseline.
function barPath(x, y, w, h, baseY) {
  const r = Math.min(4, h / 2, w / 2);
  if (h <= 0) return '';
  return `M ${x} ${baseY} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${baseY} Z`;
}

export default function WeeklyBars({ title, weeks, getValue, color, formatValue }) {
  const [hover, setHover] = useState(null);

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;
  const values = weeks.map(getValue);
  const max = niceMax(Math.max(...values, 1));
  const band = plotW / weeks.length;
  const barW = Math.min(MAX_BAR, band - GAP);

  const labelStep = Math.ceil(weeks.length / 6);
  const hovered = hover !== null ? weeks[hover] : null;

  return (
    <div className="weekly-bars">
      <h4>{title}</h4>
      <div className="weekly-bars-plot">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${title} by week: ${weeks.map((w, i) => `week of ${fmtDate(w.start)} ${formatValue(values[i])}`).join(', ')}`}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={PAD.top + plotH * (1 - f)}
                y2={PAD.top + plotH * (1 - f)}
                className="weekly-gridline"
              />
              <text x={PAD.left} y={PAD.top + plotH * (1 - f) - 4} className="weekly-axis-label">
                {formatValue(Math.round(max * f))}
              </text>
            </g>
          ))}

          {weeks.map((w, i) => {
            const h = (values[i] / max) * plotH;
            const x = PAD.left + band * i + (band - barW) / 2;
            return (
              <g key={w.start}>
                <path
                  d={barPath(x, baseY - h, barW, h, baseY)}
                  fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
                <rect
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`Week of ${fmtDate(w.start)}: ${formatValue(values[i])}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
                {i % labelStep === 0 && (
                  <text x={PAD.left + band * i + band / 2} y={HEIGHT - 8} textAnchor="middle" className="weekly-axis-label">
                    {fmtDate(w.start)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div
            className="weekly-tooltip"
            style={{ left: `${((PAD.left + band * hover + band / 2) / WIDTH) * 100}%` }}
          >
            <span className="weekly-tooltip-value">{formatValue(values[hover])}</span>
            <span className="weekly-tooltip-label">
              {fmtDate(hovered.start)} – {fmtDate(hovered.end)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
