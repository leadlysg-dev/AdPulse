import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate, number, pctChange, percent } from '../lib/format';
import TopNav from '../components/TopNav';
import DateRangePicker from '../components/DateRangePicker';
import KpiCard from '../components/KpiCard';
import TrendChart from '../components/TrendChart';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import './Seo.css';

const position = (v) => (v == null ? '—' : `#${(+Number(v).toFixed(1)).toLocaleString()}`);

function buildCards(data) {
  const t = data.totals;
  const p = data.previous || {};
  return [
    {
      id: 'clicks',
      label: 'Clicks',
      valueText: number(t.clicks),
      pct: pctChange(t.clicks, p.clicks),
      goodUp: true,
      series: data.daily.clicks,
      fmt: number,
      color: 'var(--series-1)'
    },
    {
      id: 'impressions',
      label: 'Impressions',
      valueText: number(t.impressions),
      pct: pctChange(t.impressions, p.impressions),
      goodUp: true,
      series: data.daily.impressions,
      fmt: number,
      color: 'var(--series-1)'
    },
    {
      id: 'ctr',
      label: 'CTR',
      valueText: t.ctrPct == null ? '—' : percent(t.ctrPct),
      pct: t.ctrPct == null ? null : pctChange(t.ctrPct, p.ctrPct),
      goodUp: true,
      series: data.daily.clicks.map((c, i) =>
        data.daily.impressions[i] > 0 ? +((c / data.daily.impressions[i]) * 100).toFixed(2) : 0
      ),
      fmt: percent,
      color: 'var(--series-2)'
    },
    {
      id: 'position',
      label: 'Average position',
      valueText: position(t.avgPosition),
      // Lower position = higher ranking, so a drop is good news.
      pct: t.avgPosition == null ? null : pctChange(t.avgPosition, p.avgPosition),
      goodUp: false,
      series: data.daily.avgPosition,
      fmt: position,
      color: 'var(--series-8)'
    }
  ];
}

function QueryTable({ title, rows, keyLabel, linkKeys = false }) {
  return (
    <section className="seo-section">
      <h2>{title}</h2>
      <div className="card seo-table-card">
        <div className="seo-table-scroll">
          <table className="seo-table">
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="seo-col-key">{keyLabel}</th>
                <th scope="col">Clicks</th>
                <th scope="col">Impressions</th>
                <th scope="col">CTR</th>
                <th scope="col">Avg position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="seo-col-key" title={r.key}>
                    {linkKeys ? (
                      <a href={r.key} target="_blank" rel="noreferrer">{r.key}</a>
                    ) : (
                      r.key
                    )}
                  </th>
                  <td>{number(r.clicks)}</td>
                  <td>{number(r.impressions)}</td>
                  <td>{r.ctrPct == null ? '—' : percent(r.ctrPct)}</td>
                  <td>{position(r.avgPosition)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default function Seo() {
  const [view, setView] = useState('last_30d');
  const [selectedCard, setSelectedCard] = useState('clicks');

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickBusy, setPickBusy] = useState(false);

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

  const loadSeo = useCallback(async (nextView) => {
    const requestId = ++viewRequestId.current;
    setDataError(null);
    setRefreshing(true);
    try {
      const result = await api.getSeo(nextView);
      if (requestId !== viewRequestId.current) return;
      setData(result);
    } catch (err) {
      if (requestId !== viewRequestId.current) return;
      setDataError(err.message);
    } finally {
      if (requestId === viewRequestId.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    loadSeo(view);
  }, [view, loadSeo]);

  if (redirecting) return null;

  async function pickProperty(siteUrl) {
    setPickBusy(true);
    try {
      await api.selectScProperty(siteUrl);
      await loadSeo(view);
    } finally {
      setPickBusy(false);
    }
  }

  const cards = data?.state === 'ok' ? buildCards(data) : [];
  const activeCard = cards.find((c) => c.id === selectedCard) || cards[0] || null;
  const chartLabels = data?.daily ? data.daily.dates.map(fmtDate) : [];

  return (
    <div className="seo-page">
      <TopNav email={status?.email} />

      <main className="seo-main">
        <div className="seo-head">
          <h1>SEO</h1>
          <DateRangePicker value={view} onChange={setView} allowCustom />
        </div>

        {data?.state === 'ok' && (
          <div className="seo-subhead">
            <span className="seo-site">{data.isDemo ? 'Sample property' : data.siteUrl}</span>
            <span className="filter-period">
              {fmtDate(data.since)} – {fmtDate(data.until)}
            </span>
          </div>
        )}

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}
        {dataError && <ErrorState message={dataError} onRetry={() => loadSeo(view)} />}

        {data?.isDemo && (
          <Banner tone="info">
            This is sample data. Connect Google in Settings to see your real search performance.
          </Banner>
        )}

        {!data && !dataError && (
          <div className="card seo-loading" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton seo-skeleton-row" />
            ))}
          </div>
        )}

        {data?.state === 'needs-reconnect' && (
          <div className="card seo-notice">
            <p>Search Console access needs one more permission.</p>
            <p className="seo-notice-sub">
              Your Google account was connected before SEO reporting existed. Reconnect once to grant
              read-only Search Console access alongside Google Ads.
            </p>
            <a className="btn btn-primary seo-notice-action" href="/.netlify/functions/auth-google">
              Reconnect Google
            </a>
          </div>
        )}

        {data?.state === 'sc-api-disabled' && (
          <div className="card seo-notice">
            <p>The Search Console API is turned off for this app.</p>
            <p className="seo-notice-sub">
              Your Google account granted access, but the app's Google Cloud project has the Search
              Console API disabled, so Google rejects every request. In the Google Cloud console, open
              APIs &amp; Services for the project that owns this app's OAuth client, enable "Google
              Search Console API", wait a few minutes, then try again. Reconnecting won't help until
              it's enabled.
            </p>
            <button type="button" className="btn btn-primary seo-notice-action" onClick={() => loadSeo(view)}>
              Try again
            </button>
          </div>
        )}

        {data?.state === 'no-properties' && (
          <EmptyState
            title="No Search Console properties"
            message="This Google account doesn't have access to any verified Search Console properties. Verify your site in Google Search Console, then reconnect."
          />
        )}

        {data?.state === 'needs-site' && (
          <div className="card seo-notice">
            <p>Which website should AdPulse track?</p>
            <p className="seo-notice-sub">Pick the Search Console property this dashboard reports on.</p>
            <ul className="seo-property-list">
              {data.properties.map((p) => (
                <li key={p.siteUrl}>
                  <button
                    type="button"
                    className="seo-property-option"
                    disabled={pickBusy}
                    onClick={() => pickProperty(p.siteUrl)}
                  >
                    <span className="seo-property-url">{p.siteUrl}</span>
                    {p.permission && <span className="seo-property-perm">{p.permission}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data?.state === 'unavailable' && (
          <ErrorState
            message="Couldn't fetch Search Console data right now — please try again in a moment."
            onRetry={() => loadSeo(view)}
          />
        )}

        {data?.state === 'ok' && (
          <div className={`seo-body${refreshing ? ' is-refreshing' : ''}`}>
            <div className="seo-band">
              {cards.map((c) => (
                <KpiCard
                  key={c.id}
                  metricId={c.id}
                  label={c.label}
                  valueText={c.valueText}
                  delta={{ pct: c.pct, goodWhenUp: c.goodUp }}
                  selected={activeCard?.id === c.id}
                  onSelect={() => setSelectedCard(c.id)}
                />
              ))}
            </div>

            {activeCard && (
              <TrendChart
                title={`${activeCard.label} over time`}
                labels={chartLabels}
                values={activeCard.series}
                color={activeCard.color}
                formatValue={activeCard.fmt}
              />
            )}

            <QueryTable title="Top search queries" rows={data.topQueries} keyLabel="Query" />
            <QueryTable title="Top pages" rows={data.topPages} keyLabel="Page" linkKeys={!data.isDemo} />

            <p className="seo-footnote">
              Search data from Google Search Console — Google publishes it with a delay of about two
              days, so the most recent days may still fill in.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
