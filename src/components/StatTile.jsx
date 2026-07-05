import './StatTile.css';

export default function StatTile({ label, value, hint }) {
  return (
    <div className="stat-tile card">
      <p className="stat-tile-label">{label}</p>
      <p className="stat-tile-value">{value}</p>
      {hint && <p className="stat-tile-hint">{hint}</p>}
    </div>
  );
}
