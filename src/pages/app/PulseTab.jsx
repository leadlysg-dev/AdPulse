import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useShell } from '../../components/Shell';
import DateSelector, { toView } from '../../components/DateSelector';
import MetricsPicker from '../../components/MetricsPicker';
import { computeKpis, labelFor, DEFAULT_TRACKED } from '../../lib/metrics';
import { CHARTS, Funnel, Trend } from '../../components/charts';

const money = (v) => 'S$' + (v || 0).toLocaleString('en-SG', { maximumFractionDigits: v >= 100 ? 0 : 2 });

// COPY RULE: no hardcoded numbers or percentages anywhere in static/default
// copy - placeholders, chips, empty states, fallback insights. Figures only
// ever appear in Claude-generated output computed from the client's actual
// data (or in values rendered from that data).
const ASK_PLACEHOLDER = 'Ask about your ads — “why did my spend jump?”';
const STEPS = {
  today: ['Adding up today’s numbers…', 'Checking Facebook and Google…', 'Comparing with your usual week…'],
  cpl: ['Working out your cost per lead…', 'Checking each ad…', 'Comparing this week to last…'],
  best: ['Lining up all your ads…', 'Checking cost and results…', 'Picking the winner…'],
  alert: ['Looking at where things usually go wrong…', 'Setting up the watch…']
};
const ANALYTICS_STEPS = ['Reading your numbers…', 'Deciding what matters most today…', 'Sketching the clearest picture…'];
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

function Delta({ pct, goodUp }) {
  if (pct === null || pct === undefined || !isFinite(pct)) return <span className="delta flat">—</span>;
  const good = goodUp === null ? null : pct >= 0 === goodUp;
  const cls = good === null ? 'flat' : good ? 'up' : 'down';
  return (
    <span className={`delta ${cls}`}>
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

/* ── AI-directed analytics ─────────────────────────────────────── */
function Analytics({ context, fallback, rangeKey }) {
  const [charts, setCharts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState(ANALYTICS_STEPS[0]);
  const timer = useRef(null);

  const load = useCallback(
    async (refresh) => {
      setLoading(true);
      let i = 0;
      setStatusMsg(ANALYTICS_STEPS[0]);
      clearInterval(timer.current);
      timer.current = setInterval(() => {
        i = (i + 1) % ANALYTICS_STEPS.length;
        setStatusMsg(ANALYTICS_STEPS[i]);
      }, 900);
      let result = { charts: [] };
      try {
        result = await api.pulseAnalytics({ context, rangeKey, refresh });
      } catch {
        // fall through to the local fallback
      }
      clearInterval(timer.current);
      setCharts(result.charts && result.charts.length ? result.charts : null);
      setLoading(false);
    },
    [context, rangeKey]
  );

  useEffect(() => {
    if (context) load(false);
    return () => clearInterval(timer.current);
  }, [context, load]);

  const shown = charts || fallback;
  return (
    <>
      <div className="section-head">
        <span className="section-title">What your numbers are saying</span>
        <button type="button" className="sbtn sbtn-ghost sbtn-sm" disabled={loading} onClick={() => load(true)}>
          ↻ Take another look
        </button>
      </div>
      {loading && (
        <div className="scard" style={{ padding: 6 }}>
          <Ekg msg={statusMsg} />
        </div>
      )}
      {!loading && (
        <div className="analytics-grid">
          {shown.map((c, i) => {
            const Chart = CHARTS[c.chart_type];
            if (!Chart) return null;
            return (
              <div className="scard analytics-card" key={i}>
                <h3>{c.title}</h3>
                <Chart data={c.data} />
                <p className="analytics-insight">✦ {c.insight}</p>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ── The tab ───────────────────────────────────────────────────── */
export default function PulseTab() {
  const { toast } = useShell();
  const [platform, setPlatform] = useState('all');
  const [range, setRange] = useState({ key: 'last_7d', label: 'Last 7 days' });
  const [compare, setCompare] = useState(true);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [tracked, setTracked] = useState(null); // null = loading
  const [customLabels, setCustomLabels] = useState({});
  const [picker, setPicker] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [showAllCols, setShowAllCols] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .trackedMetrics()
      .then((r) => {
        if (cancelled) return;
        if (r.metrics && r.metrics.length) setTracked(r.metrics);
        else {
          setTracked(DEFAULT_TRACKED);
          setNeedsOnboarding(true);
        }
      })
      .catch(() => !cancelled && setTracked(DEFAULT_TRACKED));
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

  const channels = useMemo(() => {
    if (!report) return [];
    const meta = report.channels.meta;
    const google = report.channels.google;
    const googleOk = google.status === 'ok';
    return platform === 'meta' ? [meta] : platform === 'google' ? (googleOk ? [google] : []) : [meta, ...(googleOk ? [google] : [])];
  }, [report, platform]);

  const kpis = useMemo(() => {
    if (!report || !tracked) return null;
    return computeKpis(tracked, channels, report.dates.length, customLabels);
  }, [report, tracked, channels, customLabels]);

  const campaigns = useMemo(
    () => (report?.campaigns || []).filter((c) => platform === 'all' || c.channel === platform),
    [report, platform]
  );

  const chatContext = useMemo(() => {
    if (!report || !kpis) return null;
    return {
      range: { id: report.range, since: report.since, until: report.until },
      trackedMetrics: kpis.filter((k) => !k.unavailable).map((k) => ({ label: k.label, value: k.value, changePct: k.pct })),
      dailySpend: channels.length ? Array.from({ length: report.dates.length }, (_, i) => channels.reduce((a, c) => a + ((c.daily?.spend || [])[i] || 0), 0)) : [],
      campaigns: campaigns.map((c) => ({ name: c.name, platform: c.channel, spend: c.spend, impressions: c.impressions, clicks: c.clicks, results: c.results, costPer: c.costPer, metric: c.metricLabel }))
    };
  }, [report, kpis, channels, campaigns]);

  // Local fallback visuals, built from the client's real numbers - shown
  // whenever the AI layout is unavailable so the section never renders
  // empty. Insights here stay number-free per the copy rule.
  const fallback = useMemo(() => {
    if (!report || !channels.length) return [];
    const sum = (key) => channels.reduce((a, c) => a + (c.totals?.[key] || 0), 0);
    const enq = channels.reduce((a, c) => a + (c.metrics?.[0]?.value || 0), 0);
    const label = channels[0]?.metrics?.[0]?.label || 'Enquiries';
    const spendDaily = Array.from({ length: report.dates.length }, (_, i) => channels.reduce((a, c) => a + ((c.daily?.spend || [])[i] || 0), 0));
    const fmtD = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
    return [
      {
        chart_type: 'funnel',
        title: 'From seeing your ad to enquiring',
        data: { stages: [
          { label: 'Saw your ad', value: Math.round(sum('impressions')) },
          { label: 'Clicked', value: Math.round(sum('clicks')) },
          { label: label, value: Math.round(enq) }
        ] },
        insight: 'This shows how people move from seeing your ad to getting in touch — the drops between steps are where attention is lost.'
      },
      {
        chart_type: 'trend',
        title: 'Your spend, day by day',
        data: { labels: report.dates.map(fmtD), series: [{ label: 'Spend (S$)', values: spendDaily.map((v) => Math.round(v * 100) / 100) }] },
        insight: 'A steady line means your budget is pacing evenly; sharp jumps are days worth a closer look.'
      }
    ];
  }, [report, channels]);

  const fmtAxis = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });

  // campaign table columns follow tracked metrics; the full set sits behind
  // "show all columns"
  const COLS = useMemo(() => {
    const per = (c) => ({
      spend: money(c.spend),
      impressions: (c.impressions || 0).toLocaleString(),
      clicks: (c.clicks || 0).toLocaleString(),
      ctr: c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) + '%' : '—',
      cpc: c.clicks > 0 ? money(c.spend / c.clicks) : '—',
      enquiries: c.results ?? '—',
      cpe: c.costPer === null || c.costPer === undefined ? '—' : money(c.costPer),
      conv_rate: c.clicks > 0 && c.results != null ? ((c.results / c.clicks) * 100).toFixed(1) + '%' : '—'
    });
    const defs = [
      ['spend', 'Spend'], ['impressions', 'Impressions'], ['clicks', 'Clicks'], ['ctr', 'CTR'],
      ['cpc', 'CPC'], ['enquiries', 'Leads'], ['cpe', 'CPL'], ['conv_rate', 'Conv. rate']
    ];
    const trackedCols = (tracked || []).filter((id) => defs.some(([d]) => d === id) || id.startsWith('event:'));
    const visible = showAllCols
      ? [...defs.map(([id]) => id), ...(tracked || []).filter((id) => id.startsWith('event:'))]
      : trackedCols.length ? trackedCols : ['spend', 'enquiries', 'cpe'];
    return {
      visible,
      header: (id) => defs.find(([d]) => d === id)?.[1] || labelFor(id, customLabels),
      cell: (id, c) => (id.startsWith('event:') ? '—' : per(c)[id] ?? '—')
    };
  }, [tracked, showAllCols, customLabels]);

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
        <button type="button" className="sbtn sbtn-ghost sbtn-sm" style={{ marginLeft: 'auto' }} onClick={() => setPicker(true)}>
          Edit tracked metrics
        </button>
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
            {kpis.map((k) => (
              <div className="scard kpi" key={k.id}>
                <span className="kpi-label">{k.label}</span>
                {k.unavailable ? (
                  <div className="kpi-quiet">
                    <span>Not connected yet</span>
                    <Link to="/settings.html">Connect to track</Link>
                  </div>
                ) : (
                  <>
                    <span className="kpi-value">{k.value}</span>
                    <div className="kpi-meta">
                      {compare ? <Delta pct={k.pct} goodUp={k.goodUp} /> : <span />}
                      <Spark values={k.spark} />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <Analytics context={chatContext} fallback={fallback} rangeKey={`${platform}:${range.key}:${range.since || ''}`} />

          <div className="section-head">
            <span className="section-title">Top campaigns</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="sbtn sbtn-ghost sbtn-sm" aria-pressed={showAllCols} onClick={() => setShowAllCols((v) => !v)}>
                {showAllCols ? 'Show tracked columns' : 'Show all columns'}
              </button>
              <Link className="sbtn sbtn-ghost sbtn-sm" to="/admanager.html">
                Open Ad Manager →
              </Link>
            </div>
          </div>
          <div className="scard" style={{ overflow: 'hidden' }}>
            <div className="table-scroll">
              <table className="spec-table">
                <thead>
                  <tr>
                    <th className="pin">Campaign</th>
                    <th>Platform</th>
                    {COLS.visible.map((id) => (
                      <th key={id} className="num">{COLS.header(id)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campaigns.length === 0 && (
                    <tr>
                      <td className="pin" colSpan={2 + COLS.visible.length}>
                        <span className="section-sub">No campaigns delivered in this period.</span>
                      </td>
                    </tr>
                  )}
                  {campaigns.map((c) => (
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
                      {COLS.visible.map((id) => (
                        <td key={id} className="num">{COLS.cell(id, c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {(picker || needsOnboarding) && tracked && (
        <MetricsPicker
          initial={tracked}
          forced={needsOnboarding}
          onClose={() => setPicker(false)}
          onSaved={(metrics, labels) => {
            setTracked(metrics);
            setCustomLabels((cur) => ({ ...cur, ...labels }));
            setPicker(false);
            setNeedsOnboarding(false);
            toast('Tracked metrics saved.');
          }}
        />
      )}
    </>
  );
}
