import { fmtDate, money, number, pctChange } from '../lib/format';
import './Insights.css';

// A change smaller than this reads as noise, not news.
const MIN_CHANGE = 5;

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

// Turns current vs previous totals into at most four plain-English callouts.
// Comparisons against a near-zero base are suppressed rather than shown as
// "+800%".
export function buildInsights(data) {
  const prev = data.previous;
  if (!prev) return [];

  const out = [];
  const leadsPct = pctChange(data.leads, prev.leads);
  const spendPct = pctChange(data.spend, prev.spend);
  const cplPct = pctChange(data.costPerLead, prev.costPerLead);

  if (cplPct !== null && data.costPerLead > 0 && Math.abs(cplPct) >= MIN_CHANGE) {
    const down = cplPct < 0;
    out.push({
      key: 'cpl',
      direction: down ? 'down' : 'up',
      tone: down ? 'good' : 'bad',
      text: `Cost per lead ${down ? 'down' : 'up'} ${Math.abs(cplPct).toFixed(0)}% vs the prior period (${money(prev.costPerLead)} → ${money(data.costPerLead)}).`
    });
  }

  if (leadsPct !== null && Math.abs(leadsPct) >= MIN_CHANGE) {
    const up = leadsPct > 0;
    out.push({
      key: 'leads',
      direction: up ? 'up' : 'down',
      tone: up ? 'good' : 'bad',
      text: `Leads ${up ? 'up' : 'down'} ${Math.abs(leadsPct).toFixed(0)}% (${number(prev.leads)} → ${number(data.leads)}).`
    });
  }

  if (spendPct !== null && Math.abs(spendPct) >= MIN_CHANGE) {
    const up = spendPct > 0;
    out.push({
      key: 'spend',
      direction: up ? 'up' : 'down',
      tone: 'neutral',
      text: `Ad spend ${up ? 'up' : 'down'} ${Math.abs(spendPct).toFixed(0)}% (${money(prev.spend)} → ${money(data.spend)}).`
    });
  }

  if (spendPct !== null && leadsPct !== null) {
    if (spendPct >= 10 && Math.abs(leadsPct) < MIN_CHANGE) {
      out.push({
        key: 'divergence',
        direction: 'flat',
        tone: 'bad',
        text: 'Spend increased but leads stayed flat — worth reviewing which ads are getting the extra budget.'
      });
    } else if (leadsPct >= 10 && Math.abs(spendPct) < MIN_CHANGE) {
      out.push({
        key: 'divergence',
        direction: 'flat',
        tone: 'good',
        text: 'Leads grew without extra spend — your ads got more efficient this period.'
      });
    }
  }

  return out.slice(0, 4);
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
