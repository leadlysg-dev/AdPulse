import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate, money, number, pctChange, percent } from '../lib/format';
import TopNav from '../components/TopNav';
import DateRangePicker, { REPORT_RANGES } from '../components/DateRangePicker';
import HistoryTable from '../components/HistoryTable';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import DashboardSkeleton from '../components/DashboardSkeleton';
import { StackedBarChart, DonutChart, PairedTrendChart, Spark } from '../components/report/ReportCharts';
import './Reporting.css';

const TYPES = [
  { value: 'all', label: 'All' },
  { value: 'leads', label: 'Leads' },
  { value: 'ba', label: 'Brand Awareness' }
];
const CHANNELS = [
  { value: 'all', label: 'All' },
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' }
];
const ALL_CHANNELS = ['meta', 'google'];
const ALL_TYPES = ['leads', 'ba'];

const LEADS_COLOR = 'var(--series-2)';
const BA_COLOR = 'var(--series-3)';
const COST_COLOR = 'var(--series-8)';

// "1 Jul 2026"
const longDate = (iso) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`)
  );
// 5006 -> "5K"
const compact = (v) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v || 0);

const costPerLabel = (label) => {
  const lower = (label || 'results').toLowerCase();
  return lower.split(' ').length === 1 ? lower.replace(/s$/, '') : lower;
};

// Sum the channel x type grid down to one cell / one daily series for the
// active filters.
function sumCells(split, channels, types) {
  const out = { spend: 0, impressions: 0, clicks: 0, results: 0, reach: 0 };
  channels.forEach((ch) =>
    types.forEach((ty) => {
      const c = split[ch][ty];
      out.spend += c.spend;
      out.impressions += c.impressions;
      out.clicks += c.clicks;
      out.results += c.results;
      out.reach += c.reach || 0;
    })
  );
  out.spend = +out.spend.toFixed(2);
  out.results = +out.results.toFixed(1);
  return out;
}

function sumDaily(daily, channels, types, key) {
  const n = daily.meta.leads[key].length;
  const out = Array(n).fill(0);
  channels.forEach((ch) =>
    types.forEach((ty) => {
      daily[ch][ty][key].forEach((v, i) => {
        out[i] += v;
      });
    })
  );
  return out.map((v) => +v.toFixed(2));
}

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

function Kpi({ label, value, sub, pct, goodUp }) {
  return (
    <div className="card report-kpi">
      <span className="report-kpi-label">{label}</span>
      <span className="report-kpi-value">{value}</span>
      {sub && <span className="report-kpi-sub">{sub}</span>}
      <DeltaChip pct={pct} goodUp={goodUp} />
    </div>
  );
}

function Tile({ label, value, sub, spark, color }) {
  return (
    <div className="card report-tile">
      <span className="report-kpi-label">{label}</span>
      <span className="report-tile-value">{value}</span>
      {sub && <span className="report-kpi-sub">{sub}</span>}
      {spark && spark.some((v) => v > 0) ? <Spark values={spark} color={color} /> : <div className="report-spark-empty" />}
    </div>
  );
}

export default function Reporting() {
  const [view, setView] = useState('last_7d');
  const [type, setType] = useState('all');
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
  const channels = channel === 'all' ? ALL_CHANNELS : [channel];
  const types = type === 'all' ? ALL_TYPES : [type];

  let body = null;
  if (data) {
    const primary = data.primaryMetric;
    const perLabel = costPerLabel(primary.label);
    const cur = sumCells(data.totals, channels, types);
    const prev = sumCells(data.previous, channels, types);

    const ratio = (c) => ({
      cpl: c.results > 0 ? c.spend / c.results : null,
      cpc: c.clicks > 0 ? c.spend / c.clicks : null,
      cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : null,
      ctr: c.impressions > 0 ? (c.clicks / c.impressions) * 100 : null
    });
    const r = ratio(cur);
    const rp = ratio(prev);
    const rateDelta = (now, before) => (now === null || before === null ? null : pctChange(now, before));

    // Leads/BA slices respect the channel filter but not the type filter -
    // they ARE the types.
    const leads = sumCells(data.totals, channels, ['leads']);
    const ba = sumCells(data.totals, channels, ['ba']);
    const leadsSpendDaily = sumDaily(data.daily, channels, ['leads'], 'spend');
    const baSpendDaily = sumDaily(data.daily, channels, ['ba'], 'spend');
    const leadsResultsDaily = sumDaily(data.daily, channels, ['leads'], 'results');
    const baImprDaily = sumDaily(data.daily, channels, ['ba'], 'impressions');
    const cplDaily = leadsSpendDaily.map((s, i) =>
      leadsResultsDaily[i] > 0 ? +(s / leadsResultsDaily[i]).toFixed(2) : null
    );
    const avgCpl = leads.results > 0 ? leads.spend / leads.results : null;
    const target = primary.targetCostPer;

    const chartLabels = data.dates.map(fmtDate);
    const spendSeries = [
      ...(types.includes('ba') ? [{ label: 'Brand Awareness', color: BA_COLOR, values: baSpendDaily }] : []),
      ...(types.includes('leads') ? [{ label: 'Leads', color: LEADS_COLOR, values: leadsSpendDaily }] : [])
    ];

    const visibleCampaigns = data.campaigns.filter((c) => channels.includes(c.channel));
    const bestCpl = visibleCampaigns
      .filter((c) => c.type === 'leads' && c.costPer !== null)
      .sort((a, b) => a.costPer - b.costPer)[0];
    const topBa = visibleCampaigns
      .filter((c) => c.type === 'ba' && (c.reach > 0 || c.impressions > 0))
      .sort((a, b) => b.reach - a.reach || b.impressions - a.impressions)[0];

    const metaCell = sumCells(data.totals, ['meta'], types);
    const googleCell = sumCells(data.totals, ['google'], types);
    const metaRatio = ratio(metaCell);
    const googleRatio = ratio(googleCell);
    const googleBadge =
      data.googleStatus === 'not-connected'
        ? 'Not connected'
        : data.googleStatus === 'no-account'
          ? 'No account linked'
          : data.googleStatus === 'error'
            ? 'Unavailable'
            : googleCell.spend === 0
              ? 'Not yet running'
              : null;

    const channelCard = (name, accentClass, cell, rr, badge) => (
      <div className={`card report-channel ${accentClass}`}>
        <div className="report-channel-head">
          <span className="report-channel-name">
            <span className={`report-channel-dot ${accentClass}`} aria-hidden="true" />
            {name}
          </span>
          {badge && <span className="report-channel-badge">{badge}</span>}
        </div>
        <dl className="report-channel-grid">
          <div><dt>Spend</dt><dd>{money(cell.spend)}</dd></div>
          <div><dt>{primary.label}</dt><dd>{number(cell.results)}</dd></div>
          <div><dt>Clicks</dt><dd>{number(cell.clicks)}</dd></div>
          <div><dt>Impr.</dt><dd>{number(cell.impressions)}</dd></div>
          <div><dt>{`CP${perLabel[0].toUpperCase()}`}</dt><dd>{rr.cpl === null ? '—' : money(rr.cpl)}</dd></div>
          <div><dt>CTR</dt><dd>{rr.ctr === null ? '0.00%' : percent(rr.ctr)}</dd></div>
        </dl>
      </div>
    );

    body = (
      <div className={`reporting-body${refreshing ? ' is-refreshing' : ''}`}>
        <div className="report-kpi-grid">
          <Kpi label="Total spend" value={money(cur.spend)} sub={`${fmtDate(data.since)} → ${fmtDate(data.until)} · ${data.dates.length}d`} pct={pctChange(cur.spend, prev.spend)} goodUp={null} />
          <Kpi label="Impressions" value={number(cur.impressions)} sub="Meta + Google" pct={pctChange(cur.impressions, prev.impressions)} goodUp={true} />
          <Kpi label="Clicks" value={number(cur.clicks)} sub="Total link clicks" pct={pctChange(cur.clicks, prev.clicks)} goodUp={true} />
          <Kpi label={primary.label} value={number(cur.results)} sub={`${primary.label} recorded in the period`} pct={pctChange(cur.results, prev.results)} goodUp={true} />
          <Kpi label={`Cost / ${perLabel}`} value={r.cpl === null ? '—' : money(r.cpl)} sub={target ? `Target ${money(target)}` : 'No target set'} pct={rateDelta(r.cpl, rp.cpl)} goodUp={false} />
          <Kpi label="CPC" value={r.cpc === null ? '—' : money(r.cpc)} sub="Cost / click" pct={rateDelta(r.cpc, rp.cpc)} goodUp={false} />
          <Kpi label="CPM" value={r.cpm === null ? '—' : money(r.cpm)} sub="Cost / 1K impr." pct={rateDelta(r.cpm, rp.cpm)} goodUp={false} />
          <Kpi label="CTR" value={r.ctr === null ? '—' : percent(r.ctr)} sub="Clicks / impressions" pct={rateDelta(r.ctr, rp.ctr)} goodUp={true} />
        </div>

        <div className="report-channel-row">
          {channelCard('Meta Ads', 'meta', metaCell, metaRatio, null)}
          {channelCard('Google Ads', 'google', googleCell, googleRatio, googleBadge)}
        </div>

        <div className="report-tile-row">
          <Tile
            label={`Total ${primary.label.toLowerCase()}`}
            value={number(leads.results)}
            sub={`from ${money(leads.spend)} lead spend`}
            spark={leadsResultsDaily}
            color={LEADS_COLOR}
          />
          <Tile
            label={`Avg cost / ${perLabel}`}
            value={avgCpl === null ? '—' : money(avgCpl)}
            sub={
              target && avgCpl !== null
                ? `target ${money(target)} · ${avgCpl <= target ? 'under' : 'over'} target`
                : target
                  ? `target ${money(target)}`
                  : 'no target set'
            }
          />
          <Tile
            label="BA reach"
            value={ba.reach > 0 ? compact(ba.reach) : '—'}
            sub={`${number(ba.impressions)} BA impressions`}
            spark={baImprDaily}
            color={BA_COLOR}
          />
        </div>

        <div className="report-chart-row">
          <StackedBarChart
            title="Daily spend by type"
            subtitle={type === 'all' ? 'Stacked: Brand Awareness (violet) vs Leads (green)' : undefined}
            labels={chartLabels}
            series={spendSeries}
            formatValue={money}
          />
          <DonutChart
            title="Spend allocation"
            subtitle="Where the budget went"
            segments={[
              { label: 'Leads', value: leads.spend, color: LEADS_COLOR },
              { label: 'Brand Awareness', value: ba.spend, color: BA_COLOR }
            ]}
            formatValue={money}
          />
        </div>

        <PairedTrendChart
          title={`Daily ${primary.label.toLowerCase()} & cost trend`}
          subtitle={`Bars = ${primary.label.toLowerCase()}, line = cost per ${perLabel}${target ? ', dashed = target' : ''}`}
          labels={chartLabels}
          bars={{ label: primary.label, color: LEADS_COLOR, values: leadsResultsDaily }}
          line={{ label: `Cost / ${perLabel}`, color: COST_COLOR, values: cplDaily }}
          target={target}
          formatBar={number}
          formatLine={money}
        />

        <div className="report-highlight-row">
          {bestCpl && (
            <div className="card report-highlight leads">
              <span className="report-highlight-caption">Best cost / {perLabel} (leads)</span>
              <span className="report-highlight-name" style={{ color: LEADS_COLOR }}>{bestCpl.name}</span>
              <span className="report-highlight-stat">{money(bestCpl.costPer)} per {perLabel}</span>
              <span className="report-kpi-sub">
                {number(bestCpl.results)} {primary.label.toLowerCase()} · {money(bestCpl.spend)} spent
              </span>
            </div>
          )}
          {topBa && (
            <div className="card report-highlight ba">
              <span className="report-highlight-caption">Top BA reach</span>
              <span className="report-highlight-name" style={{ color: BA_COLOR }}>{topBa.name}</span>
              <span className="report-highlight-stat">
                {topBa.reach > 0 ? `${number(topBa.reach)} people` : `${number(topBa.impressions)} impressions`}
              </span>
              <span className="report-kpi-sub">{money(topBa.spend)} spent</span>
            </div>
          )}
        </div>

        {channel !== 'google' && history?.weeks?.length > 0 && (
          <section className="reporting-section">
            <h2>Last 12 weeks</h2>
            <HistoryTable history={history} />
          </section>
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
        </div>

        <div className="card report-controls">
          <div className="report-control-row">
            <span className="report-control-label">Type</span>
            <div className="range-picker" role="group" aria-label="Campaign type">
              {TYPES.map((t) => (
                <button key={t.value} type="button" className={`range-picker-option${type === t.value ? ' selected' : ''}`} aria-pressed={type === t.value} onClick={() => setType(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
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
          <p className="report-classification-note">
            <strong>Type classification:</strong> campaigns with <code>LEAD</code> in the name are counted
            as Leads. All other campaigns are counted as Brand Awareness.
          </p>
        </div>

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}
        {dataError && <ErrorState message={dataError} onRetry={() => loadView(view)} />}

        {data?.isDemo && data?.error && <Banner tone="warning">{data.error}</Banner>}
        {data?.isDemo && !data?.error && (
          <Banner tone="info">This is sample data. Connect Meta and Google to see your real numbers.</Banner>
        )}
        {data?.googleStatus === 'error' && (
          <Banner tone="warning">Couldn't fetch Google Ads figures — showing Meta only. ({data.googleError})</Banner>
        )}

        {initialLoading && <DashboardSkeleton />}

        {body}
      </main>
    </div>
  );
}
