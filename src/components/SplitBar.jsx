import './SplitBar.css';

const GAP = 2;

export default function SplitBar({ title, segments, formatValue = (v) => v }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="split-bar card">
      <h3>{title}</h3>

      {total <= 0 ? (
        <p className="split-bar-empty">No spend recorded yet.</p>
      ) : (
        <>
          <div className="split-bar-track">
            {segments.map((s, i) => {
              const pct = (s.value / total) * 100;
              return (
                <div
                  key={s.name}
                  className="split-bar-segment"
                  style={{
                    width: `${pct}%`,
                    background: s.color,
                    marginLeft: i === 0 ? 0 : `${GAP}px`
                  }}
                  role="img"
                  aria-label={`${s.name}: ${formatValue(s.value)}, ${pct.toFixed(0)}% of spend`}
                />
              );
            })}
          </div>

          <ul className="split-bar-legend">
            {segments.map((s) => (
              <li key={s.name}>
                <span className="swatch" style={{ background: s.color }} />
                <span className="split-bar-name">{s.name}</span>
                <span className="split-bar-value">{formatValue(s.value)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
