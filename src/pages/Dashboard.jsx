import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDate, money, number, pctChange } from '../lib/format';
import TopNav from '../components/TopNav';
import ConnectRow from '../components/ConnectRow';
import DateRangePicker from '../components/DateRangePicker';
import StatTile from '../components/StatTile';
import TrendChart from '../components/TrendChart';
import SplitBar from '../components/SplitBar';
import Insights from '../components/Insights';
import HistoryCard from '../components/HistoryCard';
import AdsSection from '../components/AdsSection';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import DashboardSkeleton from '../components/DashboardSkeleton';
import './Dashboard.css';

export default function Dashboard() {
  const [params] = useSearchParams();
  const justConnected = params.get('connected');

  const [range, setRange] = useState('last_30d');

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

  if (redirecting) {
    return null;
  }

  const initialLoading = data === null && !dataError;
  const noActivity = data && !data.isDemo && data.leads === 0 && data.spend === 0;

  const chartLabels = data?.daily ? data.daily.dates.map(fmtDate) : [];

  return (
    <div className="dashboard-page">
      <TopNav email={status?.email} />

      <main className="dashboard-main">
        <div className="dashboard-head">
          <h1>Your ad performance</h1>
          {status && <ConnectRow metaConnected={status.metaConnected} googleConnected={status.googleConnected} />}
        </div>

        {justConnected && (
          <Banner tone="success">
            {justConnected === 'meta' ? 'Meta' : 'Google'} account connected. Numbers below may take a minute to reflect it.
          </Banner>
        )}

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}

        {data?.isDemo && data?.error && <Banner tone="warning">{data.error}</Banner>}
        {data?.isDemo && !data?.error && (
          <Banner tone="info">This is sample data. Connect Meta and Google above to see your real numbers.</Banner>
        )}

        <div className="filter-row">
          <DateRangePicker value={range} onChange={setRange} />
          {data && (
            <span className="filter-period">
              {fmtDate(data.since)} – {fmtDate(data.until)}
            </span>
          )}
        </div>

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
                <Insights data={data} />

                <div className="stat-grid">
                  <StatTile
                    label={`Leads (${rangeLabel(range)})`}
                    value={number(data.leads)}
                    delta={{ pct: pctChange(data.leads, data.previous?.leads), goodWhenUp: true }}
                  />
                  <StatTile
                    label="Ad spend"
                    value={money(data.spend)}
                    delta={{ pct: pctChange(data.spend, data.previous?.spend), goodWhenUp: null }}
                  />
                  <StatTile
                    label="Cost per lead"
                    value={money(data.costPerLead)}
                    delta={{ pct: pctChange(data.costPerLead, data.previous?.costPerLead), goodWhenUp: false }}
                  />
                </div>

                <div className="chart-grid">
                  <TrendChart
                    title="Leads over time"
                    labels={chartLabels}
                    values={data.daily.leads}
                    color="var(--series-1)"
                    formatValue={number}
                  />
                  <TrendChart
                    title="Spend over time"
                    labels={chartLabels}
                    values={data.daily.spend}
                    color="var(--series-8)"
                    formatValue={money}
                  />
                </div>

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
              </>
            )}
          </div>
        )}

        <HistoryCard history={history} error={historyError} onRetry={loadHistory} />

        <div className={refreshing ? 'is-refreshing' : undefined}>
          <AdsSection
            ads={adsError ? null : ads?.ads}
            error={adsError}
            onRetry={() => loadRangeScoped(range)}
            googleConnected={!!status?.googleConnected}
          />
        </div>
      </main>
    </div>
  );
}

function rangeLabel(range) {
  switch (range) {
    case 'last_7d':
      return 'last 7 days';
    case 'this_month':
      return 'this month';
    case 'last_month':
      return 'last month';
    default:
      return 'last 30 days';
  }
}
