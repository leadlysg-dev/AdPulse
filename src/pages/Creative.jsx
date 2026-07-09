import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { money, number } from '../lib/format';
import TopNav from '../components/TopNav';
import DateRangePicker, { REPORT_RANGES } from '../components/DateRangePicker';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import './Creative.css';

function PreviewImage({ ad }) {
  const src = ad.imageUrl || ad.thumbnailUrl;
  if (src) {
    return <img className="preview-image" src={src} alt={`Creative for ${ad.name}`} loading="lazy" />;
  }
  return (
    <div className="preview-image preview-image-placeholder" aria-hidden="true">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="9" cy="10" r="1.6" fill="currentColor" />
        <path d="M5 17l4.5-4.5 3 3L16 12l3 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function Creative() {
  const [view, setView] = useState('last_30d');
  const [sort, setSort] = useState({ key: 'spend', dir: 'desc' });

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  const [ads, setAds] = useState(null);
  const [adsError, setAdsError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const viewRequestId = useRef(0);

  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const s = await api.getStatus();
      if (!s.loggedIn) {
        setRedirecting(true);
        window.location.href = '/login.html';
        return;
      }
      setStatus(s);
    } catch (err) {
      setStatusError(err.message);
    }
  }, []);

  const loadAds = useCallback(async (nextView) => {
    const requestId = ++viewRequestId.current;
    setAdsError(null);
    setRefreshing(true);
    try {
      const result = await api.getAds(nextView);
      if (requestId !== viewRequestId.current) return;
      setAds(result);
    } catch (err) {
      if (requestId !== viewRequestId.current) return;
      setAdsError(err.message);
    } finally {
      if (requestId === viewRequestId.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    loadAds(view);
  }, [view, loadAds]);

  if (redirecting) return null;

  const metrics = ads?.metrics || [];
  const primary = metrics[0] || null;
  const googleAds = ads?.googleAds || [];

  // Rows with derived cost-per-result, sorted by the active column.
  const rows = (ads?.ads || []).map((ad) => {
    const results = primary ? ad.values?.[primary.id] || 0 : 0;
    return { ...ad, costPer: results > 0 ? ad.spend / results : null };
  });
  const dir = sort.dir === 'asc' ? 1 : -1;
  const valueFor = (row) => {
    if (sort.key === 'name') return row.name || '';
    if (sort.key === 'spend') return row.spend;
    if (sort.key === 'costPer') return row.costPer ?? Infinity;
    return row.values?.[sort.key] || 0; // metric column
  };
  rows.sort((a, b) => {
    const av = valueFor(a);
    const bv = valueFor(b);
    return typeof av === 'string' ? av.localeCompare(bv) * dir : (av - bv) * dir;
  });

  const setSortKey = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '');

  return (
    <div className="creative-page">
      <TopNav email={status?.email} />

      <main className="creative-main">
        <div className="creative-head">
          <h1>Creative</h1>
          <DateRangePicker value={view} onChange={setView} allowCustom presets={REPORT_RANGES} />
        </div>

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}
        {ads?.isDemo && (
          <Banner tone="info">This is sample data. Connect Meta in Settings to see your real ads.</Banner>
        )}
        {adsError && <ErrorState message={adsError} onRetry={() => loadAds(view)} />}

        {!adsError && ads === null && (
          <div className="card creative-loading" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton creative-skeleton-row" />
            ))}
          </div>
        )}

        {!adsError && ads && rows.length === 0 && (
          <EmptyState
            title="No active ads in this period"
            message="Ads that are paused or ended don't show here — only what's currently running."
          />
        )}

        {!adsError && ads && rows.length > 0 && (
          <div className={`creative-body${refreshing ? ' is-refreshing' : ''}`}>
            <section className="creative-section">
              <h2>Performance by ad · Meta</h2>
              <div className="card creative-table-card">
                <div className="creative-table-scroll">
                  <table className="creative-table">
                    <caption className="visually-hidden">Creative-level performance</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="creative-col-name">
                          <button type="button" onClick={() => setSortKey('name')}>Ad{arrow('name')}</button>
                        </th>
                        <th scope="col">
                          <button type="button" onClick={() => setSortKey('spend')}>Spend{arrow('spend')}</button>
                        </th>
                        {metrics.map((m) => (
                          <th scope="col" key={m.id}>
                            <button type="button" onClick={() => setSortKey(m.id)}>{m.label}{arrow(m.id)}</button>
                          </th>
                        ))}
                        {primary && (
                          <th scope="col">
                            <button type="button" onClick={() => setSortKey('costPer')}>
                              Cost / {primary.label.toLowerCase().replace(/s$/, '')}{arrow('costPer')}
                            </button>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((ad) => (
                        <tr key={ad.id}>
                          <th scope="row" className="creative-col-name" title={ad.name}>{ad.name}</th>
                          <td>{money(ad.spend)}</td>
                          {metrics.map((m) => (
                            <td key={m.id}>{number(ad.values?.[m.id] || 0)}</td>
                          ))}
                          {primary && <td>{ad.costPer === null ? '—' : money(ad.costPer)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="creative-section">
              <h2>Ad previews</h2>
              <div className="preview-grid">
                {rows.map((ad) => (
                  <article key={`meta:${ad.id}`} className="card preview-card">
                    <PreviewImage ad={ad} />
                    <div className="preview-copy">
                      <span className="preview-name" title={ad.name}>
                        <span className="preview-platform meta">Meta</span>
                        {ad.name}
                      </span>
                      {ad.headline && <p className="preview-headline">{ad.headline}</p>}
                      {ad.body && <p className="preview-body">{ad.body}</p>}
                      <span className="preview-stats">
                        {money(ad.spend)} spent
                        {primary ? ` · ${number(ad.values?.[primary.id] || 0)} ${primary.label.toLowerCase()}` : ''}
                      </span>
                    </div>
                  </article>
                ))}
                {googleAds.map((ad) => (
                  <article key={`google:${ad.id}`} className="card preview-card">
                    <PreviewImage ad={ad} />
                    <div className="preview-copy">
                      <span className="preview-name" title={ad.name}>
                        <span className="preview-platform google">Google</span>
                        {ad.name}
                      </span>
                      {ad.headline && <p className="preview-headline">{ad.headline}</p>}
                      {ad.body && <p className="preview-body">{ad.body}</p>}
                      <span className="preview-stats">
                        {money(ad.spend)} spent · {number(ad.conversions)} conv.
                      </span>
                    </div>
                  </article>
                ))}
              </div>
              {googleAds.length > 0 && (
                <p className="creative-footnote">
                  Google previews are built from each ad's assets (headlines, descriptions, images) —
                  Google doesn't provide rendered previews over its API.
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
