import { useState } from 'react';
import WeeklyBars from './WeeklyBars';
import ErrorState from './ErrorState';
import { fmtDate, money, number } from '../lib/format';
import './HistoryCard.css';

export default function HistoryCard({ history, error, onRetry }) {
  const [showTable, setShowTable] = useState(false);

  if (error) {
    return (
      <section className="history-section">
        <h2>Last 12 weeks</h2>
        <ErrorState message={error} onRetry={onRetry} />
      </section>
    );
  }

  if (!history) {
    return (
      <section className="history-section">
        <h2>Last 12 weeks</h2>
        <div className="skeleton history-skeleton" />
      </section>
    );
  }

  const weeks = history.weeks;

  return (
    <section className="history-section">
      <div className="history-head">
        <h2>Last 12 weeks</h2>
        <button
          type="button"
          className="table-toggle"
          onClick={() => setShowTable((s) => !s)}
          aria-pressed={showTable}
        >
          {showTable ? 'View charts' : 'View as table'}
        </button>
      </div>

      <div className="card history-card">
        {showTable ? (
          <table className="history-table">
            <caption className="visually-hidden">Weekly leads, spend and cost per lead for the last 12 weeks</caption>
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Leads</th>
                <th scope="col">Spend</th>
                <th scope="col">Cost per lead</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.start}>
                  <th scope="row">
                    {fmtDate(w.start)} – {fmtDate(w.end)}
                  </th>
                  <td>{number(w.leads)}</td>
                  <td>{money(w.spend)}</td>
                  <td>{w.leads ? money(w.costPerLead) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="history-charts">
            <WeeklyBars
              title="Leads by week"
              weeks={weeks}
              getValue={(w) => w.leads}
              color="var(--series-1)"
              formatValue={number}
            />
            <WeeklyBars
              title="Spend by week"
              weeks={weeks}
              getValue={(w) => w.spend}
              color="var(--series-8)"
              formatValue={money}
            />
          </div>
        )}
      </div>
    </section>
  );
}
