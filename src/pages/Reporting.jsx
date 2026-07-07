import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate, money, number, pctChange, percent } from '../lib/format';
import TopNav from '../components/TopNav';
import DateRangePicker from '../components/DateRangePicker';
import KpiCard from '../components/KpiCard';
import TrendChart from '../components/TrendChart';
import SplitBar from '../components/SplitBar';
import HistoryTable from '../components/HistoryTable';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import DashboardSkeleton from '../components/DashboardSkeleton';
import './Reporting.css';

const CHANNELS = [
  { value: 'all', label: 'All channels' },
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' }
];

// Divide two daily series point by point; days with an empty denominator
// plot as 0 rather than a spike.
function dailyRatio(numerators, denominators, scale = 1) {
  return (numerators || []).map((n, i) => {
    const d = (denominators || [])[i];
    return d > 0 ? +((n / d) * scale).toFixed(2) : 0;
  });
}

// "Leads" -> "lead", but multi-word labels stay as-is ("Messaging
// conversations started" reads wrong with its trailing s clipped).
function costPerLabel(label) {
  const lower = label.toLowerCase();
  return lower.split(' ').length === 1 ? lower.replace(/s$/, '') : lower;
}

// Exactly 8 cards in a fixed category order: money in, then delivery, then
// engagement, then what the customer pays per result on THEIR tracked
// metric, then raw result counts. Each card carries the daily series and
// formatter the trend chart uses when it's selected.
function buildCards(data) {
  const prev = data.previous || {};
  const d = data.daily || {};
  const metrics = data.metrics || [];
  const primary = metrics[0] || null;

  const ctr = data.impressions > 0 ? (data.clicks / data.impressions) * 100 : null;
  const prevCtr = prev.impressions > 0 ? (prev.clicks / prev.impressions) * 100 : null;
  const cpc = data.clicks > 0 ? data.spend / data.clicks : null;
  const prevCpc = prev.clicks > 0 ? prev.spend / prev.clicks : null;

  // The last two slots are raw event counts: the customer's tracked metrics
  // first, padded with landing page views when fewer than two are tracked.
  const countCards = [
    ...metrics.map((m) => ({
      id: `metric:${m.id}`,
      label: m.label,
      valueText: number(m.value),
      pct: pctChange(m.value, m.previous),
      goodUp: true,
      series: m.daily,
      fmt: number,
      color: 'var(--series-1)',
      metric: m
    })),
    {
      id: 'lpv',
      label: 'Landing page views',
      // null = the channel doesn't have this concept (Google Ads view)
      valueText: data.landingPageViews == null ? '—' : number(data.landingPageViews),
      pct: data.landingPageViews == null ? null : pctChange(data.landingPageViews, prev.landingPageViews),
      goodUp: true,
      series: d.landingPageViews || [],
      fmt: number,
      color: 'var(--series-1)'
    }
  ].slice(0, 2);

  return [
    {
      id: 'spend',
      label: 'Ad spend',
      valueText: money(data.spend),
      pct: pctChange(data.spend, prev.spend),
      goodUp: null,
      series: d.spend,
      fmt: money,
      color: 'var(--series-8)'
    },
    {
      id: 'impressions',
      label: 'Impressions',
      valueText: number(data.impressions),
      pct: pctChange(data.impressions, prev.impressions),
      goodUp: true,
      series: d.impressions,
      fmt: number,
      color: 'var(--series-1)'
    },
    {
      id: 'clicks',
      label: 'Clicks',
      valueText: number(data.clicks),
      pct: pctChange(data.clicks, prev.clicks),
      goodUp: true,
      series: d.clicks,
      fmt: number,
      color: 'var(--series-1)'
    },
    {
      id: 'ctr',
      label: 'CTR',
      valueText: ctr === null ? '—' : percent(ctr),
      pct: ctr === null ? null : pctChange(ctr, prevCtr),
      goodUp: true,
      series: dailyRatio(d.clicks, d.impressions, 100),
      fmt: percent,
      color: 'var(--series-2)'
    },
    {
      id: 'cpc',
      label: 'Cost per click',
      valueText: cpc === null ? '—' : money(cpc),
      pct: cpc === null ? null : pctChange(cpc, prevCpc),
      goodUp: false,
      series: dailyRatio(d.spend, d.clicks),
      fmt: money,
      color: 'var(--series-8)'
    },
    primary && {
      id: 'costper',
      label: `Cost per ${costPerLabel(primary.label)}`,
      valueText: primary.costPer > 0 ? money(primary.costPer) : '—',
      pct: primary.costPer > 0 ? pctChange(primary.costPer, primary.prevCostPer) : null,
      goodUp: false,
      series: dailyRatio(d.spend, primary.daily),
      fmt: money,
      color: 'var(--series-8)'
    },
    ...countCards
  ].filter(Boolean);
}

export default function Reporting() {
  const [view, setView] = useState('last_30d'); // named range or {since, until}
  const [channel, setChannel] = useState('all');
  const [selectedCard, setSelectedCard] = useState(null);

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [history, setHistory] = useState(null);

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

  const loadView = useCallback(async (nextView, nextChannel) => {
    const requestId = ++viewRequestId.current;
    setDataError(null);
    setRefreshing(true);
    try {
      const result = await api.getDashboardData(nextView, nextChannel);
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
    api.getHistory().then(setHistory, () => setHistory(null));
  }, [loadStatus]);

  useEffect(() => {
    loadView(view, channel);
  }, [view, channel, loadView]);

  if (redirecting) return null;

  const initialLoading = data === null && !dataError;
  const noActivity =
    data &&
    !data.isDemo &&
    !data.googleNotReady &&
    data.spend === 0 &&
    (data.metrics || []).every((m) => m.value === 0);

  const cards = data ? buildCards(data) : [];
  const primary = data?.metrics?.[0] || null;
  const defaultCardId = primary ? `metric:${primary.id}` : 'spend';
  const activeId = cards.some((c) => c.id === selectedCard) ? selectedCard : defaultCardId;
  const activeCard = cards.find((c) => c.id === activeId) || null;
  const chartLabels = data?.daily ? data.daily.dates.map(fmtDate) : [];

  async function saveGoal(metricId, targetCostPer) {
    await api.setGoal('meta', metricId, targetCostPer);
    await loadView(view, channel);
  }

  return (
    <div className="reporting-page">
      <TopNav email={status?.email} />

      <main className="reporting-main">
        <div className="reporting-head">
          <h1>Reporting</h1>
          <DateRangePicker value={view} onChange={setView} allowCustom />
        </div>

        <div className="reporting-subhead">
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

        {dataError && <ErrorState message={dataError} onRetry={() => loadView(view, channel)} />}

        {data?.googleError && !data.googleNotReady && (
          <Banner tone="warning">
            Couldn't fetch Google Ads figures — showing Meta only. ({data.googleError})
          </Banner>
        )}

        {data?.googleNotReady === 'not-connected' && (
          <EmptyState
            title="Google isn't connected"
            message="Connect your Google account in Settings to see Google Ads numbers here."
          />
        )}
        {data?.googleNotReady === 'no-account' && (
          <EmptyState
            title="No Google Ads account selected"
            message="Google is connected but no ad account is linked yet. Reconnect Google in Settings to pick one."
          />
        )}
        {data?.googleNotReady === 'error' && (
          <ErrorState
            message={`Couldn't fetch Google Ads data: ${data.googleError}`}
            onRetry={() => loadView(view, channel)}
          />
        )}

        {data && !dataError && !data.googleNotReady && (
          <div className={`reporting-body${refreshing ? ' is-refreshing' : ''}`}>
            {noActivity ? (
              <EmptyState
                title="No activity in this period"
                message="Your connected account didn't record any spend or results in the selected date range. Try a longer range, or check that your campaigns are running."
              />
            ) : (
              <>
                <div className="funnel-band">
                  {cards.map((c) => (
                    <KpiCard
                      key={c.id}
                      metricId={c.id}
                      label={c.label}
                      valueText={c.valueText}
                      delta={{ pct: c.pct, goodWhenUp: c.goodUp }}
                      costPer={c.metric?.costPer}
                      targetCostPer={c.metric?.targetCostPer}
                      selected={activeId === c.id}
                      onSelect={() => setSelectedCard(c.id)}
                      onSaveGoal={
                        c.metric && !data.isDemo && c.metric.canSetGoal !== false
                          ? (target) => saveGoal(c.metric.id, target)
                          : undefined
                      }
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

                {channel === 'all' && (
                  <section className="reporting-section">
                    <SplitBar
                      title="Spend by platform"
                      formatValue={money}
                      segments={[
                        { name: 'Meta', value: data.metaSpend, color: 'var(--series-1)' },
                        { name: 'Google', value: data.googleSpend, color: 'var(--series-2)' }
                      ]}
                    />
                  </section>
                )}

                {/* Weekly history is built from the Meta account, so it
                    doesn't belong under the Google-only filter. */}
                {channel !== 'google' && history?.weeks?.length > 0 && (
                  <section className="reporting-section">
                    <h2>Last 12 weeks</h2>
                    <HistoryTable history={history} />
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
