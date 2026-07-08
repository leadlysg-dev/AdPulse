import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import './AiInsights.css';

const RANGE_LABELS = {
  last_7d: 'the last 7 days',
  last_30d: 'the last 30 days',
  this_month: 'this month so far',
  last_month: 'last month'
};

// "2026-07-06T09:14:00Z" -> "Jul 6, 9:14 AM"
const fmtTimestamp = (iso) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));

// The summary is plain text: a short overview, then "- " bullet lines.
function SummaryText({ text }) {
  const lines = text.split('\n').filter((l) => l.trim());
  const prose = lines.filter((l) => !l.trim().startsWith('- '));
  const bullets = lines.filter((l) => l.trim().startsWith('- ')).map((l) => l.trim().slice(2));
  return (
    <>
      {prose.map((p, i) => (
        <p key={i} className="ai-insights-text">{p}</p>
      ))}
      {bullets.length > 0 && (
        <ul className="ai-insights-bullets">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function AiInsights({ range }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');

  // Per-view memory for this page visit: toggling back to a range already
  // loaded shows its summary instantly (no skeleton) while a silent
  // background call revalidates against the server cache.
  const viewCache = useRef({});
  const currentRange = useRef(range);
  currentRange.current = range;

  const load = useCallback(async (targetRange, { refresh = false, silent = false, check = false } = {}) => {
    if (refresh) setRefreshing(true);
    try {
      const result = await api.getAiInsights(targetRange, refresh, check);
      viewCache.current[targetRange] = result;
      if (currentRange.current !== targetRange) return; // user toggled away mid-flight
      setData(result);
      setFailed(false);
      if (result.rateLimited) {
        setNotice('Just refreshed — try again in a few minutes.');
      } else if (result.stale) {
        setNotice("Couldn't fetch fresh insights — showing the last summary.");
      } else if (!silent) {
        setNotice('');
      }
    } catch {
      // A failed silent revalidation keeps showing the summary we have.
      if (currentRange.current === targetRange && !silent) setFailed(true);
    } finally {
      if (currentRange.current === targetRange) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const firstRange = useRef(true);
  useEffect(() => {
    setNotice('');
    // A range switch always verifies against the live numbers (check) so a
    // changed account never shows a stale summary; the very first load can
    // take the cache fast-path.
    const isSwitch = !firstRange.current;
    firstRange.current = false;
    const seen = viewCache.current[range];
    if (seen) {
      // Instant: render the known summary, revalidate quietly behind it.
      setData(seen);
      setLoading(false);
      setFailed(false);
      load(range, { silent: true, check: isSwitch });
    } else {
      setLoading(true);
      load(range, { check: isSwitch });
    }
  }, [range, load]);

  // AI features are off, or the account isn't connected yet: no card at all.
  if (!loading && !failed && (data?.enabled === false || data?.reason === 'not-connected')) {
    return null;
  }

  return (
    <section className="ai-insights card" aria-label="AI insights">
      <div className="ai-insights-head">
        <h2>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.95 2.55L22.5 18.5l-2.55.95L19 22l-.95-2.55-2.55-.95 2.55-.95L19 15z"
              fill="currentColor"
            />
          </svg>
          AI Insights
        </h2>
        {data?.available && !loading && (
          <div className="ai-insights-meta">
            <span className="ai-insights-updated">Updated {fmtTimestamp(data.generatedAt)}</span>
            <button
              type="button"
              className="ai-insights-refresh"
              onClick={() => load(range, { refresh: true })}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="ai-insights-skeleton" aria-hidden="true">
          <div className="skeleton ai-skeleton-line" style={{ width: '92%' }} />
          <div className="skeleton ai-skeleton-line" style={{ width: '78%' }} />
          <div className="skeleton ai-skeleton-line" style={{ width: '55%' }} />
        </div>
      )}

      {!loading && (failed || data?.available === false) && (
        <div className="ai-insights-unavailable">
          <p>Insights are temporarily unavailable — your numbers below are unaffected.</p>
          <button
            type="button"
            className="ai-insights-refresh"
            onClick={() => {
              setLoading(true);
              load(range, {});
            }}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && data?.available && (
        <>
          <SummaryText text={data.summary} />
          {notice && <p className="ai-insights-notice">{notice}</p>}
          <p className="ai-insights-footnote">
            Generated by AI from your ad data for {RANGE_LABELS[data.range] || 'the selected period'} —
            check the numbers below before acting on it.
          </p>
        </>
      )}
    </section>
  );
}
