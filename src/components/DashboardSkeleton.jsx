import './DashboardSkeleton.css';

export default function DashboardSkeleton() {
  return (
    <div className="dash-skeleton" aria-busy="true" aria-label="Loading dashboard data">
      <div className="skeleton-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton skeleton-tile" />
        ))}
      </div>
      <div className="skeleton-charts">
        <div className="skeleton skeleton-chart" />
        <div className="skeleton skeleton-chart" />
      </div>
      <div className="skeleton skeleton-chart-wide" />
    </div>
  );
}
