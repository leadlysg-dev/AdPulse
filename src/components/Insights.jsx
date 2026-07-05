import { fmtDate, money, number, pctChange } from '../lib/format';
import './Insights.css';

// A change smaller than this reads as noise, not news.
const MIN_CHANGE = 5;
const MAX_CALLOUTS = 3;

function Arrow({ direction, tone }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`insight-arrow insight-arrow-${tone}`}
      style={direction === 'down' ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d="M12 19V5m0 0l-6 6m6-6l6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Flat({ tone }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`insight-arrow insight-arrow-${tone}`}>
      <path d="M4 12h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// Turns current vs previous totals into a few plain-English callouts, one
// pass over every tracked metric. Ranked by size of change so the biggest
// stories survive the cap. Comparisons against a near-zero base are
// suppressed rather than shown as "+800%".
export function buildInsights(data) {
  const metrics = data.metrics || [];
  const spendPct = pctChange(data.spend, data.previous?.spend);
  const out = [];

  metrics.forEach((m) => {
    const cplPct = pctChange(m.costPer, m.prevCostPer);
    if (cplPct !== null && m.costPer > 0 && Math.abs(cplPct) >= MIN_CHANGE) {
      const down = cplPct < 0;
      out.push({
        key: `cpl-${m.id}`,
        group: m.id,
        rank: Math.abs(cplPct),
        direction: down ? 'down' : 'up',
        tone: down ? 'good' : 'bad',
        text: `${m.label} — cost per result ${down ? 'down' : 'up'} ${Math.abs(cplPct).toFixed(0)}% vs the prior period (${money(m.prevCostPer)} → ${money(m.costPer)}).`
      });
    }

    const valuePct = pctChange(m.value, m.previous);
    if (valuePct !== null && Math.abs(valuePct) >= MIN_CHANGE) {
      const up = valuePct > 0;
      out.push({
        key: `val-${m.id}`,
        group: m.id,
        rank: Math.abs(valuePct),
        direction: up ? 'up' : 'down',
        tone: up ? 'good' : 'bad',
        text: `${m.label} ${up ? 'up' : 'down'} ${Math.abs(valuePct).toFixed(0)}% (${number(m.previous)} → ${number(m.value)}).`
      });
    }

    // Spend/results divergence - the "money moved but results didn't" story.
    if (spendPct !== null && valuePct !== null) {
      if (spendPct >= 10 && Math.abs(valuePct) < MIN_CHANGE) {
        out.push({
          key: `div-${m.id}`,
          group: m.id,
          rank: Math.abs(spendPct) + 10,
          direction: 'flat',
          tone: 'bad',
          text: `Spend increased but ${m.label.toLowerCase()} stayed flat — worth reviewing which ads are getting the extra budget.`
        });
      } else if (valuePct >= 10 && Math.abs(spendPct) < MIN_CHANGE) {
        out.push({
          key: `div-${m.id}`,
          group: m.id,
          rank: Math.abs(valuePct) + 10,
          direction: 'flat',
          tone: 'good',
          text: `${m.label} grew without extra spend — your ads got more efficient this period.`
        });
      }
    }
  });

  if (spendPct !== null && Math.abs(spendPct) >= MIN_CHANGE) {
    out.push({
      key: 'spend',
      group: 'spend',
      rank: Math.abs(spendPct),
      direction: spendPct > 0 ? 'up' : 'down',
      tone: 'neutral',
      text: `Ad spend ${spendPct > 0 ? 'up' : 'down'} ${Math.abs(spendPct).toFixed(0)}% (${money(data.previous.spend)} → ${money(data.spend)}).`
    });
  }

  // One callout per metric before any metric gets a second, so a single
  // volatile metric can't crowd out the rest of the story.
  const ranked = out.sort((a, b) => b.rank - a.rank);
  const picked = [];
  const seenGroups = new Set();
  ranked.forEach((ins) => {
    if (picked.length < MAX_CALLOUTS && !seenGroups.has(ins.group)) {
      seenGroups.add(ins.group);
      picked.push(ins);
    }
  });
  ranked.forEach((ins) => {
    if (picked.length < MAX_CALLOUTS && !picked.includes(ins)) {
      picked.push(ins);
    }
  });
  return picked;
}

export default function Insights({ data }) {
  const insights = buildInsights(data);

  return (
    <div className="insights card">
      <div className="insights-head">
        <h3>Insights</h3>
        {data.prevSince && (
          <span className="insights-period">
            vs {fmtDate(data.prevSince)} – {fmtDate(data.prevUntil)}
          </span>
        )}
      </div>

      {insights.length === 0 ? (
        <p className="insights-empty">No significant changes vs the prior period.</p>
      ) : (
        <ul className="insights-list">
          {insights.map((ins) => (
            <li key={ins.key}>
              {ins.direction === 'flat' ? <Flat tone={ins.tone} /> : <Arrow direction={ins.direction} tone={ins.tone} />}
              <span>{ins.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
