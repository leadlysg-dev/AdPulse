import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useShell } from '../../components/Shell';
import DateSelector, { toView } from '../../components/DateSelector';
import MetricsOnboarding from '../../components/MetricsOnboarding';
import TableControls, { filterPredicate } from '../../components/TableControls';
import {
  masterKpis,
  masterColumns,
  campaignValue,
  formatCol,
  goodUpFor,
  blendedPrimary,
  visibleChannels,
  dailyOf,
  prevDailyOf,
  singular,
  sgd
} from '../../lib/metrics';
import { Funnel, DualTrend, BandTrend, SharePairs, Leaderboard, Heatmap } from '../../components/charts';

// COPY RULE: no hardcoded numbers or percentages anywhere in static/default
// copy - placeholders, chips, empty states, captions. Figures only ever
// appear computed from the client's actual data (or in Claude output).
const ASK_PLACEHOLDER = 'Ask about your ads — “why did my spend jump?”';
const STEPS = {
  today: ['Adding up today’s numbers…', 'Checking Facebook and Google…', 'Comparing with your usual week…'],
  cpl: ['Working out your cost per lead…', 'Checking each ad…', 'Comparing this week to last…'],
  best: ['Lining up all your ads…', 'Checking cost and results…', 'Picking the winner…'],
  alert: ['Looking at where things usually go wrong…', 'Setting up the watch…']
};
const DEFAULT_CHIPS = [
  { key: 'today', color: 'c-green', label: 'How did my ads do today?' },
  { key: 'cpl', color: 'c-cobalt', label: 'What’s my cost per lead?' },
  { key: 'best', color: 'c-purple', label: 'Which ad is doing best?' },
  { key: 'alert', color: 'c-amber', label: 'Warn me if something goes wrong' }
];

function RichText({ text }) {
  const parts = String(text || '').split(/\*\*/);
  return <p>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}</p>;
}

function Spark({ values }) {
  const pts = useMemo(() => {
    const v = values && values.length > 1 ? values : [0, 0];
    const max = Math.max(...v, 1);
    const min = Math.min(...v, 0);
    const span = max - min || 1;
    return v.map((y, i) => `${((i / (v.length - 1)) * 88).toFixed(1)},${(24 - ((y - min) / span) * 19 + 1).toFixed(1)}`);
  }, [values]);
  return (
    <svg className="spark" viewBox="0 0 88 26" aria-hidden="true">
      <polygon className="fill" points={`${pts.join(' ')} 88,26 0,26`} />
      <polyline points={pts.join(' ')} />
    </svg>
  );
}

function Delta({ pct, goodUp, small }) {
  if (pct === null || pct === undefined || !isFinite(pct)) return small ? null : <span className="delta flat">—</span>;
  const good = goodUp === null ? null : pct >= 0 === goodUp;
  const cls = good === null ? 'flat' : good ? 'up' : 'down';
  return (
    <span className={`delta ${cls}${small ? ' delta-sm' : ''}`}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function Ekg({ msg }) {
  return (
    <div className="pb-loading">
      <svg className="ekg" viewBox="0 0 120 24" aria-hidden="true">
        <path d="M0 12h28l6-8 8 16 7-12 5 4h66" fill="none" />
      </svg>
      <span className="pb-status">{msg}</span>
    </div>
  );
}

/* ── The Pulse AI bar (this tab only) ─────────────────────────── */
function PulseBar({ context }) {
  const { role, toast } = useShell();
  const [chips, setChips] = useState(DEFAULT_CHIPS);
  const [phase, setPhase] = useState('idle');
  const [statusMsg, setStatusMsg] = useState(STEPS.today[0]);
  const [answer, setAnswer] = useState(null);
  const [typed, setTyped] = useState('');
  const [question, setQuestion] = useState('');
  const timers = useRef([]);
  const clearTimers = () => {
    timers.current.forEach((t) => clearInterval(t));
    timers.current = [];
  };

  useEffect(() => {
    let cancelled = false;
    api.pulseChips().then((r) => {
      if (!cancelled && Array.isArray(r.chips) && r.chips.length === 4) setChips(r.chips);
    }).catch(() => {});
    return () => {
      cancelled = true;
      clearTimers();
    };
  }, []);

  const run = useCallback(
    async (key, text) => {
      if (phase === 'loading') return;
      clearTimers();
      setPhase('loading');
      setAnswer(null);
      setTyped('');
      const steps = STEPS[key] || STEPS.today;
      let i = 0;
      setStatusMsg(steps[0]);
      timers.current.push(setInterval(() => {
        i = (i + 1) % steps.length;
        setStatusMsg(steps[i]);
      }, 850));
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const minWait = reduced ? 400 : 2100;
      const started = Date.now();
      let result;
      try {
        result = await api.pulseChat({ message: text, chip: key, context, role });
      } catch (err) {
        result = { reply: `I couldn't reach your numbers just now (${err.message}). Try again in a moment.`, actions: [] };
      }
      setTimeout(() => {
        clearTimers();
        setAnswer(result);
        setPhase('done');
        const full = String(result.reply || '');
        if (reduced) return setTyped(full);
        let n = 0;
        timers.current.push(setInterval(() => {
          n = Math.min(full.length, n + 3);
          setTyped(full.slice(0, n));
          if (n >= full.length) clearTimers();
        }, 12));
      }, Math.max(0, minWait - (Date.now() - started)));
    },
    [phase, context, role]
  );

  const act = async (a) => {
    if (a.kind === 'admanager') return (window.location.href = '/admanager.html');
    if (a.kind === 'studio') return (window.location.href = '/studio.html');
    if (a.kind === 'create_alert' && answer?.alert) {
      try {
        await api.createAlert(answer.alert);
        toast('Done — I’ll warn you the moment it happens.');
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (a.kind === 'change_request') {
      try {
        await api.changeRequestCreate({ request: a.request || question || typed.slice(0, 200) });
        toast('Sent to Leadly — they’ll action it shortly.');
      } catch (err) {
        toast(err.message);
      }
    }
  };

  return (
    <div className="pulse-bar" role="complementary" aria-label="Pulse assistant">
      <div className="pb-top">
        <div className="pb-mark">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
            <path d="M1 9h3l2-5 3 8 2-5h4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="pb-input">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && question.trim() && run(null, question.trim())}
            placeholder={ASK_PLACEHOLDER}
            aria-label="Ask Pulse about your ads"
          />
          <button type="button" className="sbtn sbtn-primary sbtn-sm" disabled={phase === 'loading'} onClick={() => question.trim() && run(null, question.trim())}>
            Ask
          </button>
        </div>
      </div>
      <div className="pb-hint">Pulse answers on your ad data — insights, chart explanations, and setting alerts.</div>
      <div className="pb-tidbits">
        {chips.map((c) => (
          <button key={c.label} type="button" className={`qchip ${c.color}`} disabled={phase === 'loading'} onClick={() => run(c.key, c.label)}>
            ✦ {c.label}
          </button>
        ))}
      </div>
      {phase !== 'idle' && (
        <div className="pb-answer">
          {phase === 'loading' && <Ekg msg={statusMsg} />}
          {phase === 'done' && answer && (
            <div className="pb-result">
              <div className="pb-result-head">
                <span className="ai-reply-label">✦ Pulse</span>
                <span className="cache-note">Generated just now</span>
              </div>
              <RichText text={typed} />
              {typed.length >= String(answer.reply || '').length && (
                <div className="insight-act">
                  {(answer.actions || []).map((a, i) => (
                    <button key={i} type="button" className={`sbtn ${i === 0 ? 'sbtn-primary' : 'sbtn-ghost'} sbtn-sm`} onClick={() => act(a)}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Six fixed diagrams ────────────────────────────────────────── */

function ChartCard({ title, caption, full, children }) {
  return (
    <div className={`scard analytics-card${full ? ' chart-full' : ''}`}>
      <h3>{title}</h3>
      {children}
      <p className="analytics-insight">{caption}</p>
    </div>
  );
}

function Quiet({ msg }) {
  return <div className="chart-quiet"><span className="section-sub">{msg}</span></div>;
}

const NOT_ENOUGH = 'Not enough data yet — this fills in as your ads deliver.';

function SixCharts({ config, report, platform, compare, range }) {
  const [heat, setHeat] = useState(null);
  const [band30, setBand30] = useState(null);

  const view = useMemo(() => toView(range), [range]);
  useEffect(() => {
    let cancelled = false;
    setHeat(null);
    api.getHeatmap(view, platform).then((r) => !cancelled && setHeat(r)).catch(() => !cancelled && setHeat({ total: 0 }));
    return () => {
      cancelled = true;
    };
  }, [view, platform]);

  // The cost-per typical range always comes from the trailing 30 days, no
  // matter what window is on screen.
  useEffect(() => {
    let cancelled = false;
    api.getReport('last_30d').then((r) => !cancelled && setBand30(r)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const channels = useMemo(() => visibleChannels(report, platform), [report, platform]);
  const primary = useMemo(() => blendedPrimary(config, report, platform), [config, report, platform]);
  const n = report.dates.length;
  const fmtD = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
  const labels = report.dates.map(fmtD);
  const name = config?.primaryResult?.name || 'Enquiries';
  const one = singular(name);

  const spendDaily = useMemo(() => dailyOf(channels, 'spend', n), [channels, n]);
  const prevSpendDaily = useMemo(
    () => (compare ? prevDailyOf(channels, 'spend', (report.prevDates || []).length || n) : null),
    [channels, compare, report, n]
  );

  // (a) Lead funnel: saw it -> clicked -> visited (Meta reports page
  // visits) -> became a result. Intent-style results (messages started)
  // arrive straight from the click, which is why the visit stage only
  // renders when Meta actually records it.
  const funnel = useMemo(() => {
    const imps = channels.reduce((a, c) => a + (c.totals?.impressions || 0), 0);
    const clicks = channels.reduce((a, c) => a + (c.totals?.clicks || 0), 0);
    if (imps <= 0) return null;
    const stages = [
      { label: 'Saw your ad', value: Math.round(imps) },
      { label: 'Clicked', value: Math.round(clicks) }
    ];
    const metaCh = channels.find((c) => c.platform === 'meta');
    const lpv = metaCh?.landingPageViews?.value || 0;
    if (lpv > 0 && platform !== 'google') stages.push({ label: 'Visited your page', value: Math.round(lpv) });
    if (primary) stages.push({ label: name, value: Math.round(primary.value) });
    return { stages };
  }, [channels, primary, name, platform]);

  // (c) cost per result per day + trailing-30-day typical range band
  const costTrend = useMemo(() => {
    if (!primary) return null;
    const values = spendDaily.map((s, i) => (primary.daily[i] > 0 ? +(s / primary.daily[i]).toFixed(2) : null));
    if (values.filter((v) => v != null).length < 3) return null;
    let band = null;
    const b30 = band30 && blendedPrimary(config, band30, platform);
    if (b30) {
      const bChannels = visibleChannels(band30, platform);
      const bSpend = dailyOf(bChannels, 'spend', band30.dates.length);
      const daily = bSpend.map((s, i) => (b30.daily[i] > 0 ? s / b30.daily[i] : null)).filter((v) => v != null).sort((a, b) => a - b);
      if (daily.length >= 5) {
        band = { lo: +daily[Math.floor(daily.length * 0.25)].toFixed(2), hi: +daily[Math.floor(daily.length * 0.75)].toFixed(2) };
      }
    }
    return { labels, values, band };
  }, [primary, spendDaily, band30, config, platform, labels]);

  // (d) Meta vs Google split: share of spend vs share of results
  const split = useMemo(() => {
    if (platform !== 'all' || !primary || primary.parts.length < 2) return null;
    const spendAll = channels.reduce((a, c) => a + (c.totals?.spend || 0), 0);
    if (spendAll <= 0 || primary.value <= 0) return null;
    return {
      resultLabel: name,
      rows: primary.parts.map((p) => ({
        label: p.platform === 'meta' ? 'Meta' : 'Google',
        dot: p.platform,
        color: p.platform === 'meta' ? 'var(--meta)' : 'var(--google)',
        spendShare: p.spend / spendAll,
        resultShare: p.value / primary.value
      }))
    };
  }, [platform, primary, channels, name]);

  // (e) leaderboard: campaigns by cost per result, best first
  const leaderboard = useMemo(() => {
    const rows = (report.campaigns || [])
      .filter((c) => (platform === 'all' || c.channel === platform) && c.results > 0 && c.costPer != null)
      .sort((a, b) => a.costPer - b.costPer)
      .slice(0, 8)
      .map((c) => ({ name: c.name, costPer: c.costPer, results: c.results }));
    return rows.length >= 2 ? { rows, unit: name.toLowerCase() } : null;
  }, [report, platform, name]);

  return (
    <>
      <div className="section-head">
        <span className="section-title">Your numbers, drawn out</span>
        <span className="section-sub">Ask Pulse to explain any of these</span>
      </div>

      <ChartCard full title={`From seeing your ad to ${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`} caption={`Each step is where attention drops off — the gap between bars shows how many people fall away before becoming ${name.toLowerCase()}.`}>
        {funnel ? <Funnel data={funnel} /> : <Quiet msg={NOT_ENOUGH} />}
      </ChartCard>

      <ChartCard full title={`Spend vs ${name.toLowerCase()}`} caption={`When the lines move together your budget is buying results; when spend rises alone, that's the day to look at.`}>
        {primary && spendDaily.some((v) => v > 0) ? (
          <DualTrend
            data={{
              labels,
              spend: spendDaily,
              results: primary.daily,
              resultLabel: name,
              prevSpend: compare ? prevSpendDaily : null,
              prevResults: compare ? primary.prevDaily : null
            }}
          />
        ) : (
          <Quiet msg={NOT_ENOUGH} />
        )}
      </ChartCard>

      <div className="analytics-grid">
        <ChartCard title={`Cost per ${one} over time`} caption="The shaded band is your usual range from the last month — dots outside it are days worth a closer look.">
          {costTrend ? <BandTrend data={costTrend} /> : <Quiet msg={NOT_ENOUGH} />}
        </ChartCard>

        <ChartCard title="Meta vs Google" caption={`Each platform's share of the money against its share of the ${name.toLowerCase()} — a platform earning more than it spends is pulling its weight.`}>
          {split ? <SharePairs data={split} /> : <Quiet msg={platform !== 'all' ? 'Switch to “All platforms” to compare them.' : 'This appears once both platforms report the mapped result.'} />}
        </ChartCard>

        <ChartCard title={`Cheapest ${name.toLowerCase()} by campaign`} caption={`Shorter, greener bars are campaigns buying ${name.toLowerCase()} cheapest — the red end is where money works hardest for least.`}>
          {leaderboard ? <Leaderboard data={leaderboard} /> : <Quiet msg={NOT_ENOUGH} />}
        </ChartCard>

        <ChartCard title={`When ${name.toLowerCase()} arrive`} caption="Darker squares are the days and hours people most often get in touch — useful for staffing replies and scheduling posts.">
          {heat === null ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : heat.total > 0 ? (
            <Heatmap data={heat} />
          ) : (
            <Quiet msg={NOT_ENOUGH} />
          )}
        </ChartCard>
      </div>
    </>
  );
}

/* ── The tab ───────────────────────────────────────────────────── */
export default function PulseTab() {
  const { status, role, toast } = useShell();
  const email = status?.email || '';
  const [platform, setPlatform] = useState('all');
  const [range, setRange] = useState({ key: 'last_7d', label: 'Last 7 days' });
  const [compare, setCompare] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(undefined); // undefined = loading, null = needs onboarding
  const [showComposition, setShowComposition] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState([]);
  const sortKey = `pulse-sort:${email}`;
  const [sort, setSort] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`pulse-sort:${email}`)) || { col: 'spend', dir: 'desc' };
    } catch {
      return { col: 'spend', dir: 'desc' };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(sortKey, JSON.stringify(sort));
    } catch {
      // storage unavailable - sort just won't persist
    }
  }, [sort, sortKey]);

  useEffect(() => {
    let cancelled = false;
    api
      .metricsConfig()
      .then((r) => !cancelled && setConfig(r.config))
      .catch(() => !cancelled && setConfig(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError(null);
    api
      .getReport(toView(range))
      .then((r) => !cancelled && setReport(r))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [range]);

  const kpis = useMemo(() => (report && config !== undefined ? masterKpis(config, report, platform) : null), [report, config, platform]);
  const primary = useMemo(() => (report ? blendedPrimary(config, report, platform) : null), [config, report, platform]);
  const cols = useMemo(() => masterColumns(config), [config]);

  const campaigns = useMemo(
    () => (report?.campaigns || []).filter((c) => platform === 'all' || c.channel === platform),
    [report, platform]
  );

  // Universal controls: search + combinable filter chips + sortable columns
  const filterFields = useMemo(
    () => [
      { id: 'platform', label: 'Platform', kind: 'choice', options: [{ value: 'meta', label: 'Meta' }, { value: 'google', label: 'Google' }] },
      { id: 'campaign', label: 'Campaign', kind: 'choice', options: campaigns.map((c) => ({ value: c.name, label: c.name })).slice(0, 20) },
      ...cols.map((c) => ({ id: c.id, label: c.label, kind: 'number', money: /spend|cost|cpc|cpm/i.test(c.id) }))
    ],
    [cols, campaigns]
  );
  const colById = useMemo(() => Object.fromEntries(cols.map((c) => [c.id, c])), [cols]);
  const rows = useMemo(() => {
    const valueOf = (c, field) =>
      field === 'platform' ? c.channel : field === 'campaign' ? c.name : campaignValue(colById[field], c);
    const keep = filterPredicate(filters, filterFields, valueOf);
    const list = campaigns.filter((c) => keep(c) && (!search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase())));
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (sort.col === 'name') list.sort((a, b) => a.name.localeCompare(b.name) * dir);
    else if (colById[sort.col]) {
      const col = colById[sort.col];
      list.sort((a, b) => ((campaignValue(col, a) ?? -Infinity) - (campaignValue(col, b) ?? -Infinity)) * dir);
    }
    return list;
  }, [campaigns, filters, filterFields, search, sort, colById]);
  const setSortCol = (col) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' }));

  const chatContext = useMemo(() => {
    if (!report || !kpis) return null;
    return {
      range: { id: report.range, since: report.since, until: report.until },
      metrics: kpis.filter((k) => !k.unavailable).map((k) => ({ label: k.label, value: k.value, changePct: k.pct })),
      primaryResult: primary
        ? {
            name: primary.name,
            total: primary.value,
            costPer: primary.costPer,
            perPlatform: primary.parts.map((p) => ({ platform: p.platform, event: p.label, count: p.value, costPer: p.costPer }))
          }
        : null,
      dailySpend: visibleChannels(report, platform).length ? dailyOf(visibleChannels(report, platform), 'spend', report.dates.length) : [],
      campaigns: rows.slice(0, 25).map((c) => ({ name: c.name, platform: c.channel, spend: c.spend, impressions: c.impressions, clicks: c.clicks, results: c.results, costPer: c.costPer, metric: c.metricLabel }))
    };
  }, [report, kpis, primary, platform, rows]);

  const fmtAxis = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
  const needsOnboarding = config === null && role !== 'client';

  return (
    <>
      <PulseBar context={chatContext} />

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="seg" role="group" aria-label="Platform">
          {[['all', 'All platforms'], ['meta', 'Meta'], ['google', 'Google']].map(([id, label]) => (
            <button key={id} type="button" className={platform === id ? 'on' : ''} onClick={() => setPlatform(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <DateSelector value={range} onChange={setRange} compare={compare} onCompare={setCompare} />

      {report && (
        <p className="section-sub" style={{ margin: '-6px 0 12px' }}>
          {fmtAxis(report.since)} – {fmtAxis(report.until)}
          {compare ? ' · vs previous period' : ''}
        </p>
      )}

      {error && (
        <div className="scard" style={{ padding: 16 }}>
          <span className="section-sub">Couldn’t load your numbers: {error}</span>
        </div>
      )}
      {(!report || !kpis) && !error && (
        <div className="kpi-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="scard kpi" key={i}>
              <div className="skeleton" style={{ height: 58 }} />
            </div>
          ))}
        </div>
      )}

      {report && kpis && (
        <>
          <div className="kpi-grid">
            {kpis.map((k) => {
              const isPrimary = k.id === 'primary' && k.primary;
              const body = k.unavailable ? (
                <div className="kpi-quiet">
                  <span>{k.quiet || 'Not tracked yet'}</span>
                  <Link to="/settings.html">Check in Settings</Link>
                </div>
              ) : (
                <>
                  <span className="kpi-value">{k.value}</span>
                  <div className="kpi-meta">
                    {compare ? <Delta pct={k.pct} goodUp={k.goodUp} /> : <span />}
                    <Spark values={k.spark} />
                  </div>
                </>
              );
              if (isPrimary) {
                return (
                  <button
                    type="button"
                    className={`scard kpi kpi-primary${showComposition ? ' open' : ''}`}
                    key={k.id}
                    aria-expanded={showComposition}
                    onClick={() => setShowComposition((v) => !v)}
                    title="See what each platform counts"
                  >
                    <span className="kpi-label">{k.label} <span className="kpi-expand">{showComposition ? '▴' : '▾'}</span></span>
                    {body}
                  </button>
                );
              }
              return (
                <div className="scard kpi" key={k.id}>
                  <span className="kpi-label">{k.label}{k.platform && <span className={`dot ${k.platform}`} style={{ marginLeft: 6 }} />}</span>
                  {body}
                </div>
              );
            })}
          </div>

          {showComposition && primary && (
            <div className="scard comp-panel">
              <div className="section-head" style={{ marginBottom: 8 }}>
                <span className="section-title" style={{ fontSize: 14 }}>What counts as {primary.name.toLowerCase()}</span>
              </div>
              {primary.parts.map((p) => (
                <div className="comp-row" key={p.platform}>
                  <span className="plat"><span className={`dot ${p.platform}`} />{p.platform === 'meta' ? 'Meta' : 'Google'}</span>
                  <span className="comp-event">{p.label}</span>
                  <span className="comp-count">{p.value % 1 ? p.value.toFixed(1) : Math.round(p.value).toLocaleString()}</span>
                  <span className="comp-cost">{p.costPer != null ? `${sgd(p.costPer)} each` : '—'}</span>
                </div>
              ))}
              <p className="section-sub" style={{ marginTop: 10 }}>
                {primary.parts.length === 2
                  ? `On Meta this counts ${primary.parts.find((p) => p.platform === 'meta')?.label}; on Google it counts ${primary.parts.find((p) => p.platform === 'google')?.label}.`
                  : `Right now this counts ${primary.parts[0].label} on ${primary.parts[0].platform === 'meta' ? 'Meta' : 'Google'}.`}
                {' '}The blended cost divides everything you spent by every {singular(primary.name)} received.
              </p>
            </div>
          )}

          <SixCharts config={config} report={report} platform={platform} compare={compare} range={range} />

          <div className="section-head">
            <span className="section-title">Top campaigns</span>
            <Link className="sbtn sbtn-ghost sbtn-sm" to="/admanager.html">
              Open Ad Manager →
            </Link>
          </div>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <TableControls
              search={search}
              onSearch={setSearch}
              filters={filters}
              onFilters={setFilters}
              fields={filterFields}
              placeholder="Search campaigns…"
            />
          </div>
          <div className="scard" style={{ overflow: 'hidden' }}>
            <div className="table-scroll">
              <table className="spec-table">
                <thead>
                  <tr>
                    <th className="pin th-sort" onClick={() => setSortCol('name')}>
                      Campaign{sort.col === 'name' && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                    </th>
                    <th>Platform</th>
                    {cols.map((c) => (
                      <th key={c.id} className="num th-sort" onClick={() => setSortCol(c.id)}>
                        {c.label}
                        {sort.col === c.id && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td className="pin" colSpan={2 + cols.length}>
                        <span className="section-sub">No campaigns match this view.</span>
                      </td>
                    </tr>
                  )}
                  {rows.map((c) => (
                    <tr key={`${c.channel}:${c.name}`}>
                      <td className="pin">
                        <div className="tname">{c.name}</div>
                      </td>
                      <td>
                        <span className="plat">
                          <span className={`dot ${c.channel}`} />
                          {c.channel === 'meta' ? 'Meta' : 'Google'}
                        </span>
                      </td>
                      {cols.map((col) => {
                        const v = campaignValue(col, c);
                        const pv = compare ? campaignValue(col, c, true) : null;
                        const pctv = compare && pv > 0 && v != null ? ((v - pv) / pv) * 100 : null;
                        return (
                          <td key={col.id} className="num">
                            {formatCol(col, v)}
                            {compare && pctv != null && <div><Delta pct={pctv} goodUp={goodUpFor(col)} small /></div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {needsOnboarding && (
        <MetricsOnboarding
          forced
          onClose={() => {}}
          onSaved={(saved) => {
            setConfig(saved);
            toast('All set — Pulse now tracks exactly what matters to you.');
          }}
        />
      )}
    </>
  );
}
