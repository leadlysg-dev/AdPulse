import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDate, money, number, pctChange, percent } from '../lib/format';
import TopNav from '../components/TopNav';
import DateRangePicker, { REPORT_RANGES } from '../components/DateRangePicker';
import HistoryTable from '../components/HistoryTable';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import DashboardSkeleton from '../components/DashboardSkeleton';
import { PairedTrendChart } from '../components/report/ReportCharts';
import LockedSection from '../components/LockedSection';
import './Reporting.css';

const CHANNELS = [
  { value: 'all', label: 'All' },
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' }
];

const RESULT_COLOR = 'var(--series-2)';
const COST_COLOR = 'var(--series-8)';

// The Pro visualization lineup - a teaser only; none of these are built
// yet. Picking one shows what's coming, nothing more.
const PRO_VIZ = [
  'Funnel flow (Sankey): impressions → clicks → results',
  'Spend heatmap calendar (weekday × week)',
  'Campaign race chart (animated spend over time)',
  'Geo map: results by region',
  'Hour-of-day performance matrix',
  'Creative fatigue curve (frequency vs CTR decay)',
  'Lead cohort grid (quality by week)',
  'Budget pacing gauge',
  'Spend vs results scatter with trendline',
  'Share-of-voice donut'
];

function ProVizPicker() {
  const [picked, setPicked] = useState('');
  return (
    <div className="card report-proviz">
      <div className="report-proviz-row">
        <label className="report-control-label" htmlFor="proviz">Visualize</label>
        <select
          id="proviz"
          className="report-proviz-select"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
        >
          <option value="">Advanced visualizations (Pro)…</option>
          {PRO_VIZ.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <span className="report-proviz-badge">Pro</span>
      </div>
      {picked && (
        <p className="report-proviz-note">
          “{picked}” arrives with the Pro plan — <Link to="/upgrade.html">see plans</Link>. Nothing to
          preview here yet.
        </p>
      )}
    </div>
  );
}

// "1 Jul 2026"
const longDate = (iso) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`)
  );

const costPerLabel = (label) => {
  const lower = (label || 'results').toLowerCase();
  return lower.split(' ').length === 1 ? lower.replace(/s$/, '') : lower;
};

// Divide two daily series point by point; empty denominators plot as null
// so the cost line simply skips days with no results.
const dailyCostPer = (spendDaily, countDaily) =>
  spendDaily.map((s, i) => (countDaily[i] > 0 ? +(s / countDaily[i]).toFixed(2) : null));

const ratios = (c) => ({
  ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : null,
  cpc: c.clicks > 0 ? c.spend / c.clicks : null
});
const rateDelta = (now, before) => (now === null || before === null ? null : pctChange(now, before));

function DeltaChip({ pct, goodUp }) {
  if (pct === null || pct === undefined) {
    return <span className="report-delta">— vs prev period</span>;
  }
  const good = goodUp === null ? null : pct >= 0 === goodUp;
  const cls = good === null ? '' : good ? ' good' : ' bad';
  return (
    <span className={`report-delta${cls}`}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}% vs prev period
    </span>
  );
}

function Kpi({ label, tag, value, sub, pct, goodUp }) {
  return (
    <div className="card report-kpi">
      <span className="report-kpi-label">
        {label}
        {tag && (
          <span className={`report-kpi-tag ${tag.toLowerCase()}`}>
            <span className={`report-channel-dot ${tag.toLowerCase()}`} aria-hidden="true" />
            {tag}
          </span>
        )}
      </span>
      <span className="report-kpi-value">{value}</span>
      {sub && <span className="report-kpi-sub">{sub}</span>}
      <DeltaChip pct={pct} goodUp={goodUp} />
    </div>
  );
}

// The approved 8-card structure for one platform: spend -> delivery ->
// engagement -> conversion (that platform's own metrics) -> raw counts.
const CARD_CAP = 16; // 4-across grid, up to 4 rows

// One count + one cost-per card per selected metric.
const metricPair = (m, tag) => [
  {
    key: `count:${tag || ''}:${m.id}`,
    label: m.label,
    tag,
    value: number(m.value),
    pct: pctChange(m.value, m.previous),
    goodUp: true
  },
  {
    key: `costper:${tag || ''}:${m.id}`,
    label: `Cost / ${costPerLabel(m.label)}`,
    tag,
    value: m.costPer === null ? '—' : money(m.costPer),
    sub: m.targetCostPer ? `Target ${money(m.targetCostPer)}` : undefined,
    pct: rateDelta(m.costPer, m.prevCostPer),
    goodUp: false
  }
];

function platformCards(ch, tag) {
  const r = ratios(ch.totals);
  const rp = ratios(ch.previous);
  return [
    { key: 'spend', label: 'Ad spend', value: money(ch.totals.spend), pct: pctChange(ch.totals.spend, ch.previous.spend), goodUp: null },
    { key: 'impressions', label: 'Impressions', value: number(ch.totals.impressions), pct: pctChange(ch.totals.impressions, ch.previous.impressions), goodUp: true },
    { key: 'clicks', label: 'Clicks', value: number(ch.totals.clicks), sub: 'Total link clicks', pct: pctChange(ch.totals.clicks, ch.previous.clicks), goodUp: true },
    { key: 'ctr', label: 'CTR', value: r.ctr === null ? '—' : percent(r.ctr), sub: 'Clicks / impressions', pct: rateDelta(r.ctr, rp.ctr), goodUp: true },
    { key: 'cpc', label: 'Cost per click', value: r.cpc === null ? '—' : money(r.cpc), pct: rateDelta(r.cpc, rp.cpc), goodUp: false },
    ch.landingPageViews && {
      key: 'lpv',
      label: 'Landing page views',
      value: number(ch.landingPageViews.value),
      sub: 'From the Meta pixel',
      pct: pctChange(ch.landingPageViews.value, ch.landingPageViews.previous),
      goodUp: true
    },
    ...ch.metrics.flatMap((m) => metricPair(m, tag))
  ]
    .filter(Boolean)
    .slice(0, CARD_CAP);
}

// "All channels": delivery blends (same unit on both platforms); conversion
// cards stay per platform, tagged - two different conversion types are
// never merged into one number.
function blendedCards(meta, google) {
  const googleOk = google.status === 'ok';
  const blend = (key) => meta.totals[key] + (googleOk ? google.totals[key] : 0);
  const blendPrev = (key) => meta.previous[key] + (googleOk ? google.previous[key] : 0);
  const cur = { spend: blend('spend'), impressions: blend('impressions'), clicks: blend('clicks') };
  const prev = { spend: blendPrev('spend'), impressions: blendPrev('impressions'), clicks: blendPrev('clicks') };
  const r = ratios(cur);
  const rp = ratios(prev);

  return [
    { key: 'spend', label: 'Ad spend', value: money(cur.spend), sub: 'Meta + Google', pct: pctChange(cur.spend, prev.spend), goodUp: null },
    { key: 'impressions', label: 'Impressions', value: number(cur.impressions), sub: 'Meta + Google', pct: pctChange(cur.impressions, prev.impressions), goodUp: true },
    { key: 'clicks', label: 'Clicks', value: number(cur.clicks), sub: 'Total link clicks', pct: pctChange(cur.clicks, prev.clicks), goodUp: true },
    { key: 'ctr', label: 'CTR', value: r.ctr === null ? '—' : percent(r.ctr), pct: rateDelta(r.ctr, rp.ctr), goodUp: true },
    { key: 'cpc', label: 'Cost per click', value: r.cpc === null ? '—' : money(r.cpc), pct: rateDelta(r.cpc, rp.cpc), goodUp: false },
    ...meta.metrics.flatMap((m) => metricPair(m, 'Meta')),
    ...(googleOk ? google.metrics.flatMap((m) => metricPair(m, 'Google')) : [])
  ].slice(0, CARD_CAP);
}

export default function Reporting() {
  const [view, setView] = useState('last_7d');
  const [channel, setChannel] = useState('all');

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

  const loadView = useCallback(async (nextView) => {
    const requestId = ++viewRequestId.current;
    setDataError(null);
    setRefreshing(true);
    try {
      const result = await api.getReport(nextView);
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
    loadView(view);
  }, [view, loadView]);

  if (redirecting) return null;

  const initialLoading = data === null && !dataError;

  let body = null;
  if (data) {
    const meta = data.channels.meta;
    const google = data.channels.google;

    // The Google-only view explains itself when Google isn't reporting yet.
    let googleNotice = null;
    if (channel === 'google' && google.status !== 'ok') {
      googleNotice =
        google.status === 'not-connected' ? (
          <EmptyState title="Google isn't connected" message="Connect your Google account in Settings to see Google Ads numbers here." />
        ) : google.status === 'no-account' ? (
          <EmptyState title="No Google Ads account selected" message="Google is connected but no ad account is linked yet. Reconnect Google in Settings to pick one." />
        ) : google.status === 'no-metrics' ? (
          <div className="card report-notice">
            <p>Which Google conversions should Pulse track?</p>
            <p className="report-notice-sub">
              Google's conversion actions are configured separately from Meta's — pick the ones that
              matter to your business and this view fills in.
            </p>
            <Link className="btn btn-primary report-notice-action" to="/select-metrics.html?provider=google">
              Choose Google metrics
            </Link>
          </div>
        ) : (
          <ErrorState message={`Couldn't fetch Google Ads data: ${google.error || 'unknown error'}`} onRetry={() => loadView(view)} />
        );
    }

    const cards =
      channel === 'meta' ? platformCards(meta) : channel === 'google' ? (google.status === 'ok' ? platformCards(google, 'Google') : []) : blendedCards(meta, google);

    // Trend chart follows the active view's primary metric.
    const trendChannel = channel === 'google' ? google : meta;
    const trendPrimary = trendChannel.status === 'ok' || channel !== 'google' ? trendChannel.metrics[0] : null;

    // Best cost-per campaign across the channels in view.
    const visible = channel === 'all' ? ['meta', 'google'] : [channel];
    const bestCampaign = (data.campaigns || [])
      .filter((c) => visible.includes(c.channel) && c.costPer !== null)
      .sort((a, b) => a.costPer - b.costPer)[0];

    body = (
      <div className={`reporting-body${refreshing ? ' is-refreshing' : ''}`}>
        {googleNotice || (
          <>
            <div className="report-kpi-grid">
              {cards.map((c) => (
                <Kpi key={c.key} label={c.label} tag={c.tag} value={c.value} sub={c.sub} pct={c.pct} goodUp={c.goodUp} />
              ))}
            </div>

            {channel === 'all' && (
              <div className="report-channel-row">
                {[
                  { name: 'Meta Ads', accent: 'meta', ch: meta, badge: null },
                  {
                    name: 'Google Ads',
                    accent: 'google',
                    ch: google,
                    badge:
                      google.status === 'not-connected'
                        ? 'Not connected'
                        : google.status === 'no-account'
                          ? 'No account linked'
                          : google.status === 'no-metrics'
                            ? 'No metrics chosen'
                            : google.status === 'error'
                              ? 'Unavailable'
                              : google.totals.spend === 0
                                ? 'Not yet running'
                                : null
                  }
                ].map(({ name, accent, ch, badge }) => {
                  const primary = ch.metrics[0];
                  const r = ratios(ch.totals);
                  return (
                    <div key={name} className={`card report-channel ${accent}`}>
                      <div className="report-channel-head">
                        <span className="report-channel-name">
                          <span className={`report-channel-dot ${accent}`} aria-hidden="true" />
                          {name}
                        </span>
                        {badge && <span className="report-channel-badge">{badge}</span>}
                      </div>
                      <dl className="report-channel-grid">
                        <div><dt>Spend</dt><dd>{money(ch.totals.spend)}</dd></div>
                        <div><dt>{primary ? primary.label : 'Results'}</dt><dd>{primary ? number(primary.value) : '—'}</dd></div>
                        <div><dt>Clicks</dt><dd>{number(ch.totals.clicks)}</dd></div>
                        <div><dt>Impr.</dt><dd>{number(ch.totals.impressions)}</dd></div>
                        <div><dt>{primary ? `Cost / ${costPerLabel(primary.label)}` : 'Cost / result'}</dt><dd>{primary && primary.costPer !== null ? money(primary.costPer) : '—'}</dd></div>
                        <div><dt>CTR</dt><dd>{r.ctr === null ? '0.00%' : percent(r.ctr)}</dd></div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            )}

            <ProVizPicker />

            <LockedSection title="daily trend charts, campaign highlights, and weekly history">
            {trendPrimary && (
              <PairedTrendChart
                title={`Daily ${trendPrimary.label.toLowerCase()} & cost trend`}
                subtitle={`Bars = ${trendPrimary.label.toLowerCase()}${channel === 'all' ? ' (Meta)' : ''}, line = cost per ${costPerLabel(trendPrimary.label)}${trendPrimary.targetCostPer ? ', dashed = target' : ''}`}
                labels={data.dates.map(fmtDate)}
                bars={{ label: trendPrimary.label, color: RESULT_COLOR, values: trendPrimary.daily }}
                line={{
                  label: `Cost / ${costPerLabel(trendPrimary.label)}`,
                  color: COST_COLOR,
                  values: dailyCostPer(trendChannel.daily.spend, trendPrimary.daily)
                }}
                target={trendPrimary.targetCostPer}
                formatBar={number}
                formatLine={money}
              />
            )}

            {bestCampaign && (
              <div className="report-highlight-row single">
                <div className="card report-highlight leads">
                  <span className="report-highlight-caption">
                    Best cost / {costPerLabel(bestCampaign.metricLabel)}
                    {channel === 'all' ? ` · ${bestCampaign.channel === 'meta' ? 'Meta' : 'Google'}` : ''}
                  </span>
                  <span className="report-highlight-name" style={{ color: RESULT_COLOR }}>{bestCampaign.name}</span>
                  <span className="report-highlight-stat">
                    {money(bestCampaign.costPer)} per {costPerLabel(bestCampaign.metricLabel)}
                  </span>
                  <span className="report-kpi-sub">
                    {number(bestCampaign.results)} {bestCampaign.metricLabel.toLowerCase()} · {money(bestCampaign.spend)} spent
                  </span>
                </div>
              </div>
            )}

            {channel !== 'google' && history?.weeks?.length > 0 && (
              <section className="reporting-section">
                <h2>Last 12 weeks</h2>
                <HistoryTable history={history} />
              </section>
            )}
            </LockedSection>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="reporting-page">
      <TopNav email={status?.email} />

      <main className="reporting-main">
        <h1 className="visually-hidden">Reporting</h1>

        <div className="card report-controls">
          <div className="report-control-row">
            <span className="report-control-label">Period</span>
            <DateRangePicker value={view} onChange={setView} allowCustom presets={REPORT_RANGES} />
            {data && (
              <span className="report-period-chip">
                {longDate(data.since)} → {longDate(data.until)} · {data.dates.length}d
              </span>
            )}
          </div>
          <div className="report-control-row">
            <span className="report-control-label">Channel</span>
            <div className="range-picker" role="group" aria-label="Channel">
              {CHANNELS.map((c) => (
                <button key={c.value} type="button" className={`range-picker-option${channel === c.value ? ' selected' : ''}`} aria-pressed={channel === c.value} onClick={() => setChannel(c.value)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}
        {dataError && <ErrorState message={dataError} onRetry={() => loadView(view)} />}

        {data?.isDemo && data?.error && <Banner tone="warning">{data.error}</Banner>}
        {data?.isDemo && !data?.error && (
          <Banner tone="info">This is sample data. Connect Meta and Google to see your real numbers.</Banner>
        )}
        {channel !== 'google' && data?.channels?.google?.status === 'error' && (
          <Banner tone="warning">Couldn't fetch Google Ads figures — showing Meta only. ({data.channels.google.error})</Banner>
        )}

        {initialLoading && <DashboardSkeleton />}

        {body}
      </main>
    </div>
  );
}
