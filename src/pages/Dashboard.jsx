import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import TopNav from '../components/TopNav';
import ConnectRow from '../components/ConnectRow';
import StatTile from '../components/StatTile';
import TrendChart from '../components/TrendChart';
import SplitBar from '../components/SplitBar';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import DashboardSkeleton from '../components/DashboardSkeleton';
import './Dashboard.css';

const money = (v) => `$${Number(v || 0).toLocaleString()}`;
const number = (v) => Number(v || 0).toLocaleString();

export default function Dashboard() {
  const [params] = useSearchParams();
  const justConnected = params.get('connected');

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);

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

  const loadData = useCallback(async () => {
    setDataError(null);
    try {
      const d = await api.getDashboardData();
      setData(d);
    } catch (err) {
      setDataError(err.message);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadData();
  }, [loadStatus, loadData]);

  if (redirecting) {
    return null;
  }

  const stillLoading = (status === null && !statusError) || (data === null && !dataError);

  return (
    <div className="dashboard-page">
      <TopNav email={status?.email} />

      <main className="dashboard-main">
        <div className="dashboard-head">
          <h1>Your ad performance</h1>
          {status && <ConnectRow metaConnected={status.metaConnected} googleConnected={status.googleConnected} />}
        </div>

        {justConnected && !stillLoading && (
          <Banner tone="success">
            {justConnected === 'meta' ? 'Meta' : 'Google'} account connected. Numbers below may take a minute to reflect it.
          </Banner>
        )}

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}

        {stillLoading && !statusError && !dataError && <DashboardSkeleton />}

        {dataError && <ErrorState message={dataError} onRetry={loadData} />}

        {data && !dataError && (
          <>
            {data.isDemo && data.error && (
              <Banner tone="warning">{data.error}</Banner>
            )}
            {data.isDemo && !data.error && (
              <Banner tone="info">
                This is sample data. Connect Meta and Google above to see your real numbers.
              </Banner>
            )}

            {!data.isDemo && data.leads === 0 && data.spend === 0 ? (
              <EmptyState
                title="No activity in the last 30 days"
                message="Your connected accounts haven't recorded any spend or leads yet. Once your campaigns are running, numbers will show up here automatically."
              />
            ) : (
              <>
                <div className="stat-grid">
                  <StatTile label="Leads (last 30 days)" value={number(data.leads)} />
                  <StatTile label="Ad spend" value={money(data.spend)} />
                  <StatTile label="Cost per lead" value={money(data.costPerLead)} />
                </div>

                <div className="chart-grid">
                  <TrendChart
                    title="Leads over time"
                    labels={data.weekly.labels}
                    values={data.weekly.leads}
                    color="var(--series-1)"
                    formatValue={number}
                  />
                  <TrendChart
                    title="Spend over time"
                    labels={data.weekly.labels}
                    values={data.weekly.spend}
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
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
