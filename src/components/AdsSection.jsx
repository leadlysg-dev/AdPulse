import ErrorState from './ErrorState';
import { money, number } from '../lib/format';
import './AdsSection.css';

function Thumb({ url, name }) {
  if (url) {
    return <img className="ad-thumb" src={url} alt={`Creative for ${name}`} loading="lazy" />;
  }
  return (
    <div className="ad-thumb ad-thumb-placeholder" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="9" cy="10" r="1.6" fill="currentColor" />
        <path d="M5 17l4.5-4.5 3 3L16 12l3 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function AdsSection({ ads, metrics, error, onRetry, googleConnected }) {
  const metricList = metrics || [];
  // Thumbnail + ad copy + spend + one column per tracked metric.
  const rowStyle = {
    gridTemplateColumns: `48px minmax(0, 1fr) 90px repeat(${metricList.length}, minmax(64px, 84px))`
  };

  return (
    <section className="ads-section">
      <div className="ads-head">
        <h2>Active ads</h2>
        {googleConnected && <span className="ads-note">Google ads coming soon — Meta shown below</span>}
      </div>

      {error && <ErrorState message={error} onRetry={onRetry} />}

      {!error && !ads && (
        <div className="card ads-card">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="ad-row" style={{ gridTemplateColumns: '48px minmax(0, 1fr)' }}>
              <div className="skeleton ad-thumb" />
              <div className="ad-row-copy">
                <div className="skeleton ad-skeleton-line" style={{ width: '40%' }} />
                <div className="skeleton ad-skeleton-line" style={{ width: '70%' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!error && ads && ads.length === 0 && (
        <div className="card ads-empty">
          <p>No active ads in this period.</p>
          <p className="ads-empty-sub">Ads that are paused or ended don't show here — only what's currently running.</p>
        </div>
      )}

      {!error && ads && ads.length > 0 && (
        <div className="card ads-card">
          <div className="ads-scroll">
            <div className="ad-row ad-row-header" style={rowStyle} aria-hidden="true">
              <span />
              <span className="ad-col-label">Ad</span>
              <span className="ad-metric-label">Spend</span>
              {metricList.map((m) => (
                <span key={m.id} className="ad-metric-label">{m.label}</span>
              ))}
            </div>
            {ads.map((ad) => (
              <div key={ad.id} className="ad-row" style={rowStyle}>
                <Thumb url={ad.thumbnailUrl} name={ad.name} />
                <div className="ad-row-copy">
                  <p className="ad-name" title={ad.name}>{ad.name}</p>
                  {(ad.headline || ad.body) && (
                    <p className="ad-copy">
                      {ad.headline && <strong>{ad.headline}</strong>}
                      {ad.headline && ad.body && ' — '}
                      {ad.body}
                    </p>
                  )}
                </div>
                <span className="ad-metric" data-label="Spend">{money(ad.spend)}</span>
                {metricList.map((m) => (
                  <span key={m.id} className="ad-metric" data-label={m.label}>
                    {number(ad.values?.[m.id] || 0)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
