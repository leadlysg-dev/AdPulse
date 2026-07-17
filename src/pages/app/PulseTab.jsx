import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useShell } from '../../components/Shell';
import DateSelector, { toView, DATE_PRESETS } from '../../components/DateSelector';
import MetricsOnboarding from '../../components/MetricsOnboarding';
import TableControls, { filterPredicate } from '../../components/TableControls';
import {
  masterKpis,
  masterColumns,
  nodeValue,
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
const THUMBS = ['t1', 't2', 't3', 't4', 't5', 't6'];

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

function PlatChip({ channel }) {
  return <span className={`plat-chip ${channel}`}>{channel === 'meta' ? 'Meta' : 'Google'}</span>;
}

// The matched-length window immediately before [since, until].
function previousWindow(since, until) {
  const DAY = 86400000;
  const s = new Date(since + 'T00:00:00Z').getTime();
  const u = new Date(until + 'T00:00:00Z').getTime();
  const len = Math.round((u - s) / DAY) + 1;
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  return { since: fmt(s - len * DAY), until: fmt(s - DAY) };
}

/* ── The Pulse AI bar (this tab only) ─────────────────────────── */
function PulseBar({ context }) {
  const { role, toast } = useShell();
  const [chips, setChips] = useState(null); // null = loading; render once, never swap mid-view
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
      if (!cancelled) setChips(Array.isArray(r.chips) && r.chips.length === 4 ? r.chips : DEFAULT_CHIPS);
    }).catch(() => !cancelled && setChips(DEFAULT_CHIPS));
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
    if (a.kind === 'admanager') return (window.location.href = '/campaigns.html');
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
        {chips === null
          ? [150, 180, 165, 190].map((w, i) => <span key={i} className="qchip qchip-ghost" style={{ width: w }} aria-hidden="true" />)
          : chips.map((c) => (
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

/* ── Six fixed diagrams (funnel is conditional) ────────────────── */

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

// Funnel-stage dictionary: awareness -> click -> page view -> intent -> result.
// The funnel only draws when the workspace tracks at least two distinct
// stages beyond clicks - one conversion metric alone is not a funnel.
const stageOf = (id, label) => {
  const s = `${id} ${label}`.toLowerCase();
  if (/page.?view|landing/.test(s)) return 'pageview';
  if (/cart|checkout|payment|schedule|trial|subscribe|sign.?up|registration|view.?content|add.?to/.test(s)) return 'intent';
  return 'result';
};

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

  // (a) conditional lead funnel, from the stage dictionary over the
  // workspace's TRACKED events (config conversions + mapped primaries)
  const funnel = useMemo(() => {
    const tracked = [...(config?.conversions || [])];
    const pr = config?.primaryResult;
    for (const p of ['meta', 'google']) {
      if (pr?.[p]) tracked.push({ id: pr[p].event, label: pr[p].label || pr[p].event, platform: p });
    }
    const stages = new Set(tracked.map((e) => stageOf(e.id, e.label)));
    if (stages.size < 2) return null; // a single stage is a number, not a funnel

    const imps = channels.reduce((a, c) => a + (c.totals?.impressions || 0), 0);
    const clicks = channels.reduce((a, c) => a + (c.totals?.clicks || 0), 0);
    if (imps <= 0) return null;
    const rows = [
      { label: 'Saw your ad', value: Math.round(imps) },
      { label: 'Clicked', value: Math.round(clicks) }
    ];
    const sumStage = (stage, fallbackLabel) => {
      let found = false;
      let value = 0;
      const labelSet = [];
      for (const ch of channels) {
        for (const m of ch.metrics || []) {
          if (stageOf(m.id, m.label) === stage) {
            found = true;
            value += m.value || 0;
            if (m.label && !labelSet.includes(m.label)) labelSet.push(m.label);
          }
        }
      }
      return found ? { label: labelSet.length === 1 ? labelSet[0] : fallbackLabel, value: Math.round(value) } : null;
    };
    const pv = sumStage('pageview', 'Visited your page');
    if (pv) rows.push(pv);
    const intent = sumStage('intent', 'Showed intent');
    if (intent) rows.push(intent);
    if (primary) rows.push({ label: name, value: Math.round(primary.value) });
    return rows.length >= 4 ? { stages: rows } : null;
  }, [config, channels, primary, name]);

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

      {funnel && (
        <ChartCard full title={`From seeing your ad to ${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`} caption={`Each step is where attention drops off — the gap between bars shows how many people fall away before becoming ${name.toLowerCase()}.`}>
          <Funnel data={funnel} />
        </ChartCard>
      )}

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

/* ── Performance breakdown: the nested tree, READ-ONLY ─────────── */
// Same nested campaign -> ad set/ad group -> ad table as the Campaigns tab,
// minus every control: no budgets, no switches, no checkboxes, no bulk bar.
// Because this view can blend platforms, every row carries its platform's
// color - Meta-blue rail + chip, Google-green rail + chip - at all levels.
function PerformanceBreakdown({ config, trees, platform, compare, prevIndex, email }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState([]);
  const [expanded, setExpanded] = useState(() => new Set());
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

  const cols = useMemo(() => masterColumns(config), [config]);
  const colById = useMemo(() => Object.fromEntries(cols.map((c) => [c.id, c])), [cols]);

  const campaigns = useMemo(() => {
    if (!trees) return null;
    const all = [];
    for (const channel of ['meta', 'google']) {
      if (platform !== 'all' && platform !== channel) continue;
      const t = trees[channel];
      if (t?.state === 'ok') {
        for (const c of t.campaigns || []) all.push({ ...c, channel, accountName: t.accountName || channel });
      }
    }
    return all;
  }, [trees, platform]);

  const accountNames = useMemo(() => [...new Set((campaigns || []).map((c) => c.accountName))], [campaigns]);
  const filterFields = useMemo(
    () => [
      { id: 'status', label: 'Status', kind: 'choice', options: [{ value: 'active', label: 'Live' }, { value: 'paused', label: 'Paused' }] },
      { id: 'platform', label: 'Platform', kind: 'choice', options: [{ value: 'meta', label: 'Meta' }, { value: 'google', label: 'Google' }] },
      ...(accountNames.length > 1
        ? [{ id: 'account', label: 'Account', kind: 'choice', options: accountNames.map((n) => ({ value: n, label: n })) }]
        : []),
      { id: 'campaign', label: 'Campaign', kind: 'choice', options: (campaigns || []).map((c) => ({ value: c.name, label: c.name })).slice(0, 20) },
      ...cols.map((c) => ({ id: c.id, label: c.label, kind: 'number', money: /spend|cost|cpc|cpm/i.test(c.id) }))
    ],
    [accountNames, campaigns, cols]
  );

  const sortNodes = useCallback(
    (list, channel) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      const out = [...list];
      if (sort.col === 'name') out.sort((a, b) => a.name.localeCompare(b.name) * dir);
      else if (colById[sort.col]) {
        const col = colById[sort.col];
        const chOf = (nd) => channel || nd.channel;
        out.sort((a, b) => ((nodeValue(col, a, chOf(a)) ?? -Infinity) - (nodeValue(col, b, chOf(b)) ?? -Infinity)) * dir);
      }
      return out;
    },
    [sort, colById]
  );
  const setSortCol = (col) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' }));

  const visible = useMemo(() => {
    if (!campaigns) return [];
    const valueOf = (c, field) =>
      field === 'status' ? c.status : field === 'platform' ? c.channel : field === 'account' ? c.accountName : field === 'campaign' ? c.name : nodeValue(colById[field], c, c.channel);
    const keep = filterPredicate(filters, filterFields, valueOf);
    const rows = campaigns.filter((c) => keep(c) && (!search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase())));
    return sortNodes(rows, null);
  }, [campaigns, search, filters, filterFields, sortNodes, colById]);

  const toggleExpand = (key) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const flatRows = useMemo(() => {
    const out = [];
    const push = (node, channel, depth) => {
      const key = `${channel}:${node.id}`;
      const isOpen = expanded.has(key);
      out.push({ node, channel, depth, key, isOpen, grpLast: false, grpOpen: depth === 0 && isOpen });
      if (isOpen) for (const child of sortNodes(node.children || [], channel)) push(child, channel, depth + 1);
    };
    for (const c of visible) {
      const before = out.length;
      push(c, c.channel, 0);
      if (out.length > before + 1) out[out.length - 1].grpLast = true;
    }
    return out;
  }, [visible, expanded, sortNodes]);

  const cellDelta = (col, node, channel) => {
    if (!compare || !prevIndex) return null;
    const prevMetrics = prevIndex[`${channel}:${node.id}`];
    if (!prevMetrics) return null;
    const cur = nodeValue(col, node, channel);
    const prev = nodeValue(col, { metrics: prevMetrics }, channel);
    if (cur == null || prev == null || prev <= 0) return null;
    return ((cur - prev) / prev) * 100;
  };

  return (
    <>
      <div className="section-head">
        <span className="section-title">Performance breakdown</span>
        <Link className="sbtn sbtn-ghost sbtn-sm" to="/campaigns.html">
          Manage in Campaigns →
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <TableControls search={search} onSearch={setSearch} filters={filters} onFilters={setFilters} fields={filterFields} placeholder="Search campaigns, ad sets, ads…" />
      </div>
      {!trees && <div className="scard" style={{ padding: 24 }}><div className="skeleton" style={{ height: 120 }} /></div>}
      {trees && (
        <div className="scard" style={{ overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="spec-table adm-table perf-table">
              <thead>
                <tr>
                  <th className="pin th-sort" onClick={() => setSortCol('name')}>
                    Campaigns{sort.col === 'name' && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th>Status</th>
                  {cols.map((c) => (
                    <th key={c.id} className="num th-sort" onClick={() => setSortCol(c.id)}>
                      {c.label}
                      {sort.col === c.id && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flatRows.length === 0 && (
                  <tr>
                    <td className="pin" colSpan={2 + cols.length}>
                      <span className="section-sub">No campaigns delivered in this view.</span>
                    </td>
                  </tr>
                )}
                {flatRows.map(({ node, channel, depth, key, isOpen, grpLast, grpOpen }) => {
                  const isOn = node.status === 'active';
                  const cls = [depth ? `lvl-${depth}` : 'lvl-0', `plat-${channel}`, grpOpen ? 'grp-open' : '', grpLast ? 'grp-last' : ''].filter(Boolean).join(' ');
                  return (
                    <tr key={key} className={cls}>
                      <td className="pin">
                        <div className="adm-name-cell">
                          {node.children?.length ? (
                            <button type="button" className={`row-toggle${isOpen ? ' open' : ''}`} aria-expanded={isOpen} aria-label={`Expand ${node.name}`} onClick={() => toggleExpand(key)}>
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2l5 4-5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                          ) : (
                            <span style={{ width: 20 }} />
                          )}
                          {depth === 2 && <div className={`ad-thumb ${THUMBS[(node.id || '').length % THUMBS.length]}`}>AD</div>}
                          <div>
                            <div className="tname">{node.name} <PlatChip channel={channel} /></div>
                            {depth === 0 && (
                              <div className="tsub">
                                {node.accountName}
                                {node.children?.length ? ` · ${node.children.length} ${channel === 'meta' ? 'ad set' : 'ad group'}${node.children.length > 1 ? 's' : ''}` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td><span className={`pill ${isOn ? 'live' : 'paused'}`}>{isOn ? 'Live' : 'Paused'}</span></td>
                      {cols.map((col) => {
                        const pct = cellDelta(col, node, channel);
                        return (
                          <td key={col.id} className="num">
                            {formatCol(col, nodeValue(col, node, channel))}
                            {pct != null && <div><Delta pct={pct} goodUp={goodUpFor(col)} small /></div>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Creative performance: every ad, flat, READ-ONLY ───────────── */
function CreativePerformance({ config, trees, email }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState([]);
  const sortKey = `creative-sort:${email}`;
  const [sort, setSort] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`creative-sort:${email}`)) || { col: 'spend', dir: 'desc' };
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

  const cols = useMemo(() => masterColumns(config), [config]);
  const colById = useMemo(() => Object.fromEntries(cols.map((c) => [c.id, c])), [cols]);

  // every ad across both platforms and all campaigns, one flat row each
  const ads = useMemo(() => {
    if (!trees) return null;
    const out = [];
    for (const channel of ['meta', 'google']) {
      const t = trees[channel];
      if (t?.state !== 'ok') continue;
      for (const camp of t.campaigns || []) {
        for (const group of camp.children || []) {
          for (const ad of group.children || []) {
            out.push({
              ...ad,
              channel,
              campaign: camp.name,
              format: (ad.metrics?.events?.video_view || 0) > 0 ? 'video' : 'image'
            });
          }
        }
      }
    }
    return out;
  }, [trees]);

  const campaignNames = useMemo(() => [...new Set((ads || []).map((a) => a.campaign))], [ads]);
  const filterFields = useMemo(
    () => [
      { id: 'platform', label: 'Platform', kind: 'choice', options: [{ value: 'meta', label: 'Meta' }, { value: 'google', label: 'Google' }] },
      { id: 'format', label: 'Format', kind: 'choice', options: [{ value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }] },
      { id: 'campaign', label: 'Campaign', kind: 'choice', options: campaignNames.map((n) => ({ value: n, label: n })).slice(0, 20) },
      ...cols.map((c) => ({ id: c.id, label: c.label, kind: 'number', money: /spend|cost|cpc|cpm/i.test(c.id) }))
    ],
    [campaignNames, cols]
  );

  const rows = useMemo(() => {
    if (!ads) return [];
    const valueOf = (a, field) =>
      field === 'platform' ? a.channel : field === 'format' ? a.format : field === 'campaign' ? a.campaign : nodeValue(colById[field], a, a.channel);
    const keep = filterPredicate(filters, filterFields, valueOf);
    const list = ads.filter((a) => keep(a) && (!search.trim() || `${a.name} ${a.campaign}`.toLowerCase().includes(search.trim().toLowerCase())));
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (sort.col === 'name') list.sort((a, b) => a.name.localeCompare(b.name) * dir);
    else if (colById[sort.col]) {
      const col = colById[sort.col];
      list.sort((a, b) => ((nodeValue(col, a, a.channel) ?? -Infinity) - (nodeValue(col, b, b.channel) ?? -Infinity)) * dir);
    }
    return list;
  }, [ads, search, filters, filterFields, sort, colById]);
  const setSortCol = (col) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' }));

  return (
    <>
      <div className="section-head" style={{ marginTop: 18 }}>
        <span className="section-title">Creative performance</span>
        <span className="section-sub">Every ad, across platforms and campaigns</span>
      </div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <TableControls search={search} onSearch={setSearch} filters={filters} onFilters={setFilters} fields={filterFields} placeholder="Search ads…" />
      </div>
      {!ads && <div className="scard" style={{ padding: 24 }}><div className="skeleton" style={{ height: 120 }} /></div>}
      {ads && (
        <div className="scard" style={{ overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="spec-table perf-table">
              <thead>
                <tr>
                  <th className="pin th-sort" onClick={() => setSortCol('name')}>
                    Ad{sort.col === 'name' && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
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
                      <span className="section-sub">No ads delivered in this view.</span>
                    </td>
                  </tr>
                )}
                {rows.map((a) => (
                  <tr key={`${a.channel}:${a.id}`} className={`plat-${a.channel}`}>
                    <td className="pin">
                      <div className="adm-name-cell">
                        <div className={`ad-thumb ${THUMBS[(a.id || '').length % THUMBS.length]}`}>{a.format === 'video' ? '▶' : 'AD'}</div>
                        <div>
                          <div className="tname">{a.name}</div>
                          <div className="tsub">{a.campaign}</div>
                        </div>
                      </div>
                    </td>
                    <td><PlatChip channel={a.channel} /></td>
                    {cols.map((col) => (
                      <td key={col.id} className="num">{formatCol(col, nodeValue(col, a, a.channel))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ── The tab ───────────────────────────────────────────────────── */
export default function PulseTab() {
  const { status, role, toast } = useShell();
  const email = status?.email || '';
  // Share-report links restore the exact view: range, platform, compare.
  const [platform, setPlatform] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('platform');
    return ['all', 'meta', 'google'].includes(p) ? p : 'all';
  });
  const [range, setRange] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const since = q.get('since');
    const until = q.get('until');
    if (since && until) return { key: 'custom', label: 'Custom', since, until };
    const preset = DATE_PRESETS.find((p) => p.key === q.get('range'));
    return preset ? { key: preset.key, label: preset.label } : { key: 'last_7d', label: 'Last 7 days' };
  });
  const [compare, setCompare] = useState(() => new URLSearchParams(window.location.search).get('compare') !== '0');
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(undefined); // undefined = loading, null = needs onboarding
  const [showComposition, setShowComposition] = useState(false);
  const [trees, setTrees] = useState(null); // { meta, google } for the breakdown + creative tables
  const [prevIndex, setPrevIndex] = useState(null);

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

  // The nested tree feeding Performance breakdown and Creative performance.
  useEffect(() => {
    let cancelled = false;
    setTrees(null);
    const view = toView(range);
    Promise.all([api.getManageTree(view, 'meta').catch(() => null), api.getManageTree(view, 'google').catch(() => null)]).then(
      ([meta, google]) => !cancelled && setTrees({ meta, google })
    );
    return () => {
      cancelled = true;
    };
  }, [range]);

  // "vs previous period" deltas for the breakdown's cells.
  useEffect(() => {
    if (!compare || !trees) {
      setPrevIndex(null);
      return;
    }
    let cancelled = false;
    const src = trees.meta?.state === 'ok' ? trees.meta : trees.google?.state === 'ok' ? trees.google : null;
    if (!src || !src.since || !src.until) return;
    const win = previousWindow(src.since, src.until);
    Promise.all([api.getManageTree(win, 'meta').catch(() => null), api.getManageTree(win, 'google').catch(() => null)]).then(([m, g]) => {
      if (cancelled) return;
      const index = {};
      const walk = (channel, nodes) => {
        for (const nd of nodes || []) {
          index[`${channel}:${nd.id}`] = nd.metrics || {};
          walk(channel, nd.children);
        }
      };
      if (m?.state === 'ok') walk('meta', m.campaigns);
      if (g?.state === 'ok') walk('google', g.campaigns);
      setPrevIndex(index);
    });
    return () => {
      cancelled = true;
    };
  }, [compare, trees]);

  const kpis = useMemo(() => (report && config !== undefined ? masterKpis(config, report, platform) : null), [report, config, platform]);
  const primary = useMemo(() => (report ? blendedPrimary(config, report, platform) : null), [config, report, platform]);

  const chatContext = useMemo(() => {
    if (!report || !kpis) return null;
    const campaigns = (report.campaigns || []).filter((c) => platform === 'all' || c.channel === platform);
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
      campaigns: campaigns.slice(0, 25).map((c) => ({ name: c.name, platform: c.channel, spend: c.spend, impressions: c.impressions, clicks: c.clicks, results: c.results, costPer: c.costPer, metric: c.metricLabel }))
    };
  }, [report, kpis, primary, platform]);

  const share = async () => {
    const p = new URLSearchParams();
    if (range.key === 'custom') {
      p.set('since', range.since);
      p.set('until', range.until);
    } else {
      p.set('range', range.key);
    }
    p.set('platform', platform);
    p.set('compare', compare ? '1' : '0');
    const url = `${window.location.origin}/pulse.html?${p.toString()}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied — it opens this exact view.');
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  const fmtAxis = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
  const needsOnboarding = config === null && role !== 'client';

  return (
    <>
      <PulseBar context={chatContext} />

      <div className="controls-sticky">
        <div className="toolbar">
          <div className="seg" role="group" aria-label="Platform">
            {[['all', 'All platforms'], ['meta', 'Meta'], ['google', 'Google']].map(([id, label]) => (
              <button key={id} type="button" className={platform === id ? 'on' : ''} onClick={() => setPlatform(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <DateSelector
          value={range}
          onChange={setRange}
          compare={compare}
          onCompare={setCompare}
          extras={
            <button type="button" className="sbtn sbtn-primary sbtn-sm" onClick={share}>
              Share report
            </button>
          }
        />
      </div>

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

          <PerformanceBreakdown config={config} trees={trees} platform={platform} compare={compare} prevIndex={prevIndex} email={email} />

          <CreativePerformance config={config} trees={trees} email={email} />
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
