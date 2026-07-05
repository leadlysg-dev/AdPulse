import { useState } from 'react';
import WeeklyBars from './WeeklyBars';
import ErrorState from './ErrorState';
import { fmtDate, money, number } from '../lib/format';
import './HistoryCard.css';

// focusMetricId: which tracked metric the charts show (progressive
// disclosure - the table still carries every metric). null = spend only.
export default function HistoryCard({ history, error, onRetry, focusMetricId }) {
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

  const { weeks, metrics } = history;
  const focusMetric = metrics.find((m) => m.id === focusMetricId) || null;

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
          <div className="history-table-scroll">
            <table className="history-table">
              <caption className="visually-hidden">Weekly results and spend for the last 12 weeks</caption>
              <thead>
                <tr>
                  <th scope="col">Week</th>
                  {metrics.map((m) => (
                    <th scope="col" key={m.id}>{m.label}</th>
                  ))}
                  <th scope="col">Spend</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.start}>
                    <th scope="row">
                      {fmtDate(w.start)} – {fmtDate(w.end)}
                    </th>
                    {metrics.map((m) => (
                      <td key={m.id}>{number(w.values[m.id] || 0)}</td>
                    ))}
                    <td>{money(w.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="history-charts">
            {focusMetric && (
              <WeeklyBars
                key={focusMetric.id}
                title={`${focusMetric.label} by week`}
                weeks={weeks}
                getValue={(w) => w.values[focusMetric.id] || 0}
                color="var(--series-1)"
                formatValue={number}
              />
            )}
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
