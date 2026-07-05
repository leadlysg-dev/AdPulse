import { useState } from 'react';
import WeeklyBars from './WeeklyBars';
import ErrorState from './ErrorState';
import { fmtDate, money, number, metricColor } from '../lib/format';
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

  const { weeks, metrics } = history;

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
            {metrics.map((m, i) => (
              <WeeklyBars
                key={m.id}
                title={`${m.label} by week`}
                weeks={weeks}
                getValue={(w) => w.values[m.id] || 0}
                color={metricColor(i)}
                formatValue={number}
              />
            ))}
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
