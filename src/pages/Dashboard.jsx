import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDate, money, number, pctChange } from '../lib/format';
import TopNav from '../components/TopNav';
import ConnectRow from '../components/ConnectRow';
import DateRangePicker from '../components/DateRangePicker';
import KpiCard from '../components/KpiCard';
import TrendChart from '../components/TrendChart';
import SplitBar from '../components/SplitBar';
import Insights from '../components/Insights';
import HistoryCard from '../components/HistoryCard';
import AdsSection from '../components/AdsSection';
import AiInsights from '../components/AiInsights';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import DashboardSkeleton from '../components/DashboardSkeleton';
import './Dashboard.css';

const SPEND_KPI = '__spend__';

export default function Dashboard() {
  const [params] = useSearchParams();
  const justConnected = params.get('connected');

  const [range, setRange] = useState('last_30d');
  // Which KPI card drives the primary chart. null = first tracked metric.
  const [selectedKpi, setSelectedKpi] = useState(null);

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);

  const [ads, setAds] = useState(null);
  const [adsError, setAdsError] = useState(null);

  // Ignore responses from a superseded range so a slow request can't
  // overwrite a newer one.
  const rangeRequestId = useRef(0);

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

  const loadHistory = useCallback(async () => {
    setHistoryError(null);
    try {
      setHistory(await api.getHistory());
    } catch (err) {
      setHistoryError(err.message);
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
    loadHistory();
  }, [loadStatus, loadHistory]);

  useEffect(() => {
    loadRangeScoped(range);
  }, [range, loadRangeScoped]);

  async function saveGoal(metricId, targetCostPer) {
    await api.setGoal('meta', metricId, targetCostPer);
    await loadRangeScoped(range);
  }

  if (redirecting) {
    return null;
  }

  const initialLoading = data === null && !dataError;
  const noActivity =
    data && !data.isDemo && data.spend === 0 && (data.metrics || []).every((m) => m.value === 0);

  const metrics = data?.metrics || [];
  const activeKpi =
    selectedKpi === SPEND_KPI
      ? SPEND_KPI
      : metrics.some((m) => m.id === selectedKpi)
        ? selectedKpi
        : metrics[0]?.id;
  const activeMetric = activeKpi === SPEND_KPI ? null : metrics.find((m) => m.id === activeKpi);

  const chartLabels = data?.daily ? data.daily.dates.map(fmtDate) : [];

  return (
    <div className="dashboard-page">
      <TopNav email={status?.email} />

      <main className="dashboard-main">
        <div className="dashboard-head">
          <h1>Your ad performance</h1>
          <DateRangePicker value={range} onChange={setRange} />
        </div>

        <div className="dashboard-subhead">
          {status && (
            <ConnectRow metaConnected={status.metaConnected} googleConnected={status.googleConnected} />
          )}
          {status?.metaConnected && (
            <Link className="edit-metrics-link" to="/select-metrics.html?provider=meta">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.58 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.86a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.34.62.98 1.02 1.69 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.97Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Tracked metrics
            </Link>
          )}
          {data && (
            <span className="filter-period">
              {fmtDate(data.since)} – {fmtDate(data.until)}
            </span>
          )}
        </div>

        {justConnected && (
          <Banner tone="success">
            {justConnected === 'meta' ? 'Meta' : 'Google'} account connected. Numbers below may take a minute to reflect it.
          </Banner>
        )}

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}

        <AiInsights />

        {data?.isDemo && data?.error && <Banner tone="warning">{data.error}</Banner>}
        {data?.isDemo && !data?.error && (
          <Banner tone="info">This is sample data. Connect Meta and Google above to see your real numbers.</Banner>
        )}

        {initialLoading && <DashboardSkeleton />}

        {dataError && <ErrorState message={dataError} onRetry={() => loadRangeScoped(range)} />}

        {data && !dataError && (
          <div className={`range-scoped${refreshing ? ' is-refreshing' : ''}`}>
            {noActivity ? (
              <EmptyState
                title="No activity in this period"
                message="Your connected account didn't record any spend or leads in the selected date range. Try a longer range, or check that your campaigns are running."
              />
            ) : (
              <>
                {/* hero spans 2 tracks; each other card takes 1, so the band
                    always fills exactly one row on desktop */}
                <div
                  className="kpi-band"
                  style={{ '--kpi-cols': Math.min(metrics.length + 2, 6) }}
                >
                  {metrics.map((m, i) => (
                    <KpiCard
                      key={m.id}
                      metricId={m.id}
                      label={m.label}
                      valueText={number(m.value)}
                      delta={{ pct: pctChange(m.value, m.previous), goodWhenUp: true }}
                      costPer={m.costPer}
                      targetCostPer={m.targetCostPer}
                      hero={i === 0}
                      selected={activeKpi === m.id}
                      onSelect={() => setSelectedKpi(m.id)}
                      onSaveGoal={data.isDemo ? undefined : (target) => saveGoal(m.id, target)}
                    />
                  ))}
                  <KpiCard
                    metricId={SPEND_KPI}
                    label="Ad spend"
                    valueText={money(data.spend)}
                    delta={{ pct: pctChange(data.spend, data.previous?.spend), goodWhenUp: null }}
                    selected={activeKpi === SPEND_KPI}
                    onSelect={() => setSelectedKpi(SPEND_KPI)}
                  />
                </div>

                <TrendChart
                  title={`${activeMetric ? activeMetric.label : 'Spend'} over time`}
                  labels={chartLabels}
                  values={activeMetric ? activeMetric.daily : data.daily.spend}
                  color={activeMetric ? 'var(--series-1)' : 'var(--series-8)'}
                  formatValue={activeMetric ? number : money}
                />

                <Insights data={data} />
              </>
            )}
          </div>
        )}

        {data && !dataError && !noActivity && (
          <div className={refreshing ? 'is-refreshing' : undefined}>
            <section className="breakdown-section">
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
          </div>
        )}

        <HistoryCard
          history={history}
          error={historyError}
          onRetry={loadHistory}
          focusMetricId={activeKpi === SPEND_KPI ? null : activeKpi}
        />

        <div className={refreshing ? 'is-refreshing' : undefined}>
          <AdsSection
            ads={adsError ? null : ads?.ads}
            metrics={ads?.metrics}
            error={adsError}
            onRetry={() => loadRangeScoped(range)}
            googleConnected={!!status?.googleConnected}
          />
        </div>
      </main>
    </div>
  );
}
