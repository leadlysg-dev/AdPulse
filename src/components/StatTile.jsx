import './StatTile.css';

// delta: { pct, goodWhenUp } - colored by direction x whether up is good;
// goodWhenUp: null renders it neutral (e.g. spend, where more isn't "bad").
export default function StatTile({ label, value, hint, delta }) {
  let deltaEl = null;
  if (delta && delta.pct !== null && Number.isFinite(delta.pct) && Math.abs(delta.pct) >= 0.5) {
    const up = delta.pct > 0;
    const tone =
      delta.goodWhenUp === null ? 'neutral' : up === delta.goodWhenUp ? 'good' : 'bad';
    deltaEl = (
      <p className={`stat-tile-delta stat-tile-delta-${tone}`}>
        {up ? '↑' : '↓'} {Math.abs(delta.pct).toFixed(0)}% vs prior period
      </p>
    );
  }

  return (
    <div className="stat-tile card">
      <p className="stat-tile-label">{label}</p>
      <p className="stat-tile-value">{value}</p>
      {deltaEl}
      {hint && <p className="stat-tile-hint">{hint}</p>}
    </div>
  );
}
