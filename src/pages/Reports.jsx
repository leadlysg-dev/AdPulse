import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate, money, multiple, number, pctChange, percent } from '../lib/format';
import TopNav from '../components/TopNav';
import DateRangePicker from '../components/DateRangePicker';
import TrendChart from '../components/TrendChart';
import SplitBar from '../components/SplitBar';
import WeeklyBars from '../components/WeeklyBars';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import DashboardSkeleton from '../components/DashboardSkeleton';
import './Reports.css';

const CHANNELS = [
  { value: 'all', label: 'All channels' },
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' }
];

// How many ads each performer column shows, and the share of total ad spend
// an ad must reach before it can be ranked - keeps a $2 test ad from
// "winning" on cost per result.
const PERFORMER_COUNT = 5;
const MIN_SPEND_SHARE = 0.01;

function DeltaLine({ pct, goodWhenUp }) {
  if (pct === null || !Number.isFinite(pct) || Math.abs(pct) < 0.5) return null;
  const up = pct > 0;
  const tone = goodWhenUp === null ? 'neutral' : up === goodWhenUp ? 'good' : 'bad';
  return (
    <span className={`report-delta report-delta-${tone}`}>
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(0)}% vs previous
    </span>
  );
}

function StatTile({ label, valueText, deltaPct, goodWhenUp, sub }) {
  return (
    <div className="report-stat card">
      <span className="report-stat-label">{label}</span>
      <p className="report-stat-value">{valueText}</p>
      <div className="report-stat-meta">
        <DeltaLine pct={deltaPct} goodWhenUp={goodWhenUp} />
        {sub && <span className="report-stat-sub">{sub}</span>}
      </div>
    </div>
  );
}

function AdThumb({ url, name }) {
  if (url) {
    return <img className="performer-thumb" src={url} alt={`Creative for ${name}`} loading="lazy" />;
  }
  return (
    <div className="performer-thumb performer-thumb-placeholder" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="9" cy="10" r="1.6" fill="currentColor" />
        <path d="M5 17l4.5-4.5 3 3L16 12l3 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function PerformerList({ title, ads, metricLabel }) {
  return (
    <div className="performer-list card">
      <h3>{title}</h3>
      <ol>
        {ads.map((ad) => (
          <li key={ad.id} className="performer-row">
            <AdThumb url={ad.thumbnailUrl} name={ad.name} />
            <div className="performer-copy">
              <span className="performer-name" title={ad.name}>{ad.name}</span>
              <span className="performer-detail">
                {money(ad.spend)} spent · {number(ad.results)} {metricLabel.toLowerCase()}
              </span>
            </div>
            <span className={`performer-cpr${ad.costPer === null ? ' performer-cpr-none' : ''}`}>
              {ad.costPer === null ? 'No results' : `${money(ad.costPer)}/result`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Divide two daily series point by point; days with an empty denominator
// plot as 0 rather than a spike.
function dailyRatio(numerators, denominators, scale = 1) {
  return numerators.map((n, i) => {
    const d = denominators[i];
    return d > 0 ? +((n / d) * scale).toFixed(2) : 0;
  });
}

export default function Reports() {
  const [range, setRange] = useState('last_30d');
  const [channel, setChannel] = useState('all');

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [ads, setAds] = useState(null);
  const [adsError, setAdsError] = useState(null);

  const [history, setHistory] = useState(null);

  const rangeRequestId = useRef(0);

  // Same session guard as the dashboard, so mid-onboarding accounts land in
  // the right picker instead of a half-empty report.
  const loadStatus = useCallback(async () => {
    setStatusError(null);
    try {
      const s = await api.getStatus();
      if (!s.loggedIn) {
        setRedirecting(true);
        window.location.href = '/login.html';
        return;
      }
      if (s.metaNeedsPick) {
        setRedirecting(true);
        window.location.href = '/select-account.html?provider=meta';
        return;
      }
      if (s.googleNeedsPick) {
        setRedirecting(true);
        window.location.href = '/select-account.html?provider=google';
        return;
      }
      if (s.metaNeedsMetrics) {
        setRedirecting(true);
        window.location.href = '/select-metrics.html?provider=meta';
        return;
      }
      setStatus(s);
    } catch (err) {
      setStatusError(err.message);
    }
  }, []);

  const loadRangeScoped = useCallback(async (nextRange) => {
    const requestId = ++rangeRequestId.current;
    setDataError(null);
    setAdsError(null);
    setRefreshing(true);

    const [dataResult, adsResult] = await Promise.allSettled([
      api.getDashboardData(nextRange),
      api.getAds(nextRange)
    ]);

    if (requestId !== rangeRequestId.current) return;

    if (dataResult.status === 'fulfilled') setData(dataResult.value);
    else setDataError(dataResult.reason.message);

    if (adsResult.status === 'fulfilled') setAds(adsResult.value);
    else setAdsError(adsResult.reason.message);

    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadStatus();
    api.getHistory().then(setHistory, () => setHistory(null));
  }, [loadStatus]);

  useEffect(() => {
    loadRangeScoped(range);
  }, [range, loadRangeScoped]);

  if (redirecting) {
    return null;
  }

  const initialLoading = data === null && !dataError;
  const noActivity =
    data && !data.isDemo && data.spend === 0 && (data.metrics || []).every((m) => m.value === 0);

  const metrics = data?.metrics || [];
  const primaryMetric = metrics[0] || null;
  const chartLabels = data?.daily ? data.daily.dates.map(fmtDate) : [];

  // Rates derived from the raw series the backend already returns.
  const ctr = data?.impressions > 0 ? (data.clicks / data.impressions) * 100 : null;
  const prevCtr =
    data?.previous?.impressions > 0 ? (data.previous.clicks / data.previous.impressions) * 100 : null;
  const roas = data?.spend > 0 ? data.revenue / data.spend : null;
  const prevRoas = data?.previous?.spend > 0 ? data.previous.revenue / data.previous.spend : null;

  const ctrDaily = data?.daily?.clicks ? dailyRatio(data.daily.clicks, data.daily.impressions, 100) : null;
  const roasDaily = data?.daily?.revenue ? dailyRatio(data.daily.revenue, data.daily.spend) : null;
  const costPerDaily =
    primaryMetric && data?.daily ? dailyRatio(data.daily.spend, primaryMetric.daily) : null;

  // Top/bottom performers by cost per result on the primary metric. Ads that
  // spent but produced nothing rank as the worst of the worst.
  const adPrimary = ads?.metrics?.[0] || null;
  let bestAds = [];
  let worstAds = [];
  if (ads?.ads && adPrimary) {
    const totalAdSpend = ads.ads.reduce((sum, a) => sum + a.spend, 0);
    const ranked = ads.ads
      .filter((a) => a.spend >= totalAdSpend * MIN_SPEND_SHARE && a.spend > 0)
      .map((a) => {
        const results = a.values?.[adPrimary.id] || 0;
        return { ...a, results, costPer: results > 0 ? +(a.spend / results).toFixed(2) : null };
      });
    bestAds = ranked
      .filter((a) => a.costPer !== null)
      .sort((a, b) => a.costPer - b.costPer)
      .slice(0, PERFORMER_COUNT);
    const bestIds = new Set(bestAds.map((a) => a.id));
    worstAds = ranked
      .filter((a) => !bestIds.has(a.id))
      .sort((a, b) => (b.costPer ?? Infinity) - (a.costPer ?? Infinity) || b.spend - a.spend)
      .slice(0, PERFORMER_COUNT);
  }

  const historyPrimary = history?.metrics?.[0] || null;

  return (
    <div className="reports-page">
      <TopNav email={status?.email} />

      <main className="reports-main">
        <div className="reports-head">
          <h1>Reports &amp; Insights</h1>
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        <div className="reports-subhead">
          <div className="range-picker" role="group" aria-label="Channel">
            {CHANNELS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`range-picker-option${channel === c.value ? ' selected' : ''}`}
                aria-pressed={channel === c.value}
                onClick={() => setChannel(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {data && (
            <span className="filter-period">
              {fmtDate(data.since)} – {fmtDate(data.until)}
            </span>
          )}
        </div>

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}

        {data?.isDemo && data?.error && <Banner tone="warning">{data.error}</Banner>}
        {data?.isDemo && !data?.error && (
          <Banner tone="info">This is sample data. Connect Meta and Google to see your real numbers.</Banner>
        )}

        {initialLoading && <DashboardSkeleton />}

        {dataError && <ErrorState message={dataError} onRetry={() => loadRangeScoped(range)} />}

        {channel === 'google' && !dataError && !initialLoading && (
          <EmptyState
            title="Google reporting isn't wired in yet"
            message="Google Ads connects for sign-in, but its live figures aren't available in AdPulse yet. Switch to All channels or Meta to see your numbers."
          />
        )}

        {data && !dataError && channel !== 'google' && (
          <div className={`reports-body${refreshing ? ' is-refreshing' : ''}`}>
            {noActivity ? (
              <EmptyState
                title="No activity in this period"
                message="Your connected account didn't record any spend or results in the selected date range. Try a longer range, or check that your campaigns are running."
              />
            ) : (
              <>
                {/* spend + each metric + CTR + ROAS, so the band fills one row */}
                <div className="report-stats" style={{ '--stat-cols': Math.min(metrics.length + 3, 6) }}>
                  <StatTile
                    label="Ad spend"
                    valueText={money(data.spend)}
                    deltaPct={pctChange(data.spend, data.previous?.spend)}
                    goodWhenUp={null}
                  />
                  {metrics.map((m) => (
                    <StatTile
                      key={m.id}
                      label={m.label}
                      valueText={number(m.value)}
                      deltaPct={pctChange(m.value, m.previous)}
                      goodWhenUp={true}
                      sub={m.costPer > 0 ? `${money(m.costPer)} per result` : null}
                    />
                  ))}
                  <StatTile
                    label="CTR"
                    valueText={ctr === null ? '—' : percent(ctr)}
                    deltaPct={ctr === null ? null : pctChange(ctr, prevCtr)}
                    goodWhenUp={true}
                    sub={data.clicks > 0 ? `${number(data.clicks)} clicks` : null}
                  />
                  <StatTile
                    label="ROAS"
                    valueText={roas === null || data.revenue === 0 ? '—' : multiple(roas)}
                    deltaPct={roas === null ? null : pctChange(roas, prevRoas)}
                    goodWhenUp={true}
                    sub={data.revenue > 0 ? `${money(data.revenue)} revenue` : 'No purchase value recorded'}
                  />
                </div>

                <section className="report-section">
                  <h2>Trends</h2>
                  <div className="report-charts">
                    <TrendChart
                      title="Spend over time"
                      labels={chartLabels}
                      values={data.daily.spend}
                      color="var(--series-8)"
                      formatValue={money}
                    />
                    {metrics.map((m) => (
                      <TrendChart
                        key={m.id}
                        title={`${m.label} over time`}
                        labels={chartLabels}
                        values={m.daily}
                        color="var(--series-1)"
                        formatValue={number}
                      />
                    ))}
                    {primaryMetric && costPerDaily && (
                      <TrendChart
                        title={`Cost per result (${primaryMetric.label})`}
                        labels={chartLabels}
                        values={costPerDaily}
                        color="var(--series-1)"
                        formatValue={money}
                      />
                    )}
                    {ctrDaily && (
                      <TrendChart
                        title="CTR over time"
                        labels={chartLabels}
                        values={ctrDaily}
                        color="var(--series-1)"
                        formatValue={percent}
                      />
                    )}
                    {roasDaily && data.revenue > 0 && (
                      <TrendChart
                        title="ROAS over time"
                        labels={chartLabels}
                        values={roasDaily}
                        color="var(--series-2)"
                        formatValue={multiple}
                      />
                    )}
                  </div>
                </section>

                <section className="report-section">
                  <h2>Channels</h2>
                  <SplitBar
                    title="Spend by platform"
                    formatValue={money}
                    segments={[
                      { name: 'Meta', value: data.metaSpend, color: 'var(--series-1)' },
                      { name: 'Google', value: data.googleSpend, color: 'var(--series-2)' }
                    ]}
                  />
                  {!data.isDemo && status?.googleConnected && (
                    <p className="google-note">
                      Google Ads is connected, but live Google figures aren't wired in yet — spend above is Meta only for now.
                    </p>
                  )}
                </section>

                {adPrimary && (bestAds.length > 0 || worstAds.length > 0) && (
                  <section className="report-section">
                    <h2>Top &amp; bottom performers</h2>
                    <p className="report-section-sub">
                      Active ads ranked by cost per {adPrimary.label.toLowerCase()}. Ads under{' '}
                      {Math.round(MIN_SPEND_SHARE * 100)}% of total spend aren't ranked.
                    </p>
                    <div className="performer-grid">
                      {bestAds.length > 0 && (
                        <PerformerList title="Most efficient" ads={bestAds} metricLabel={adPrimary.label} />
                      )}
                      {worstAds.length > 0 && (
                        <PerformerList title="Least efficient" ads={worstAds} metricLabel={adPrimary.label} />
                      )}
                    </div>
                  </section>
                )}
                {adsError && <ErrorState message={adsError} onRetry={() => loadRangeScoped(range)} />}

                {history?.weeks?.length > 0 && (
                  <section className="report-section">
                    <h2>Last 12 weeks</h2>
                    <div className="report-charts">
                      <div className="card report-weekly-card">
                        <WeeklyBars
                          title="Spend by week"
                          weeks={history.weeks}
                          getValue={(w) => w.spend}
                          color="var(--series-8)"
                          formatValue={money}
                        />
                      </div>
                      {historyPrimary && (
                        <div className="card report-weekly-card">
                          <WeeklyBars
                            title={`${historyPrimary.label} by week`}
                            weeks={history.weeks}
                            getValue={(w) => w.values?.[historyPrimary.id] || 0}
                            color="var(--series-1)"
                            formatValue={number}
                          />
                        </div>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
