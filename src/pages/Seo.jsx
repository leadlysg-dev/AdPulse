import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate, number } from '../lib/format';
import TopNav from '../components/TopNav';
import DateRangePicker, { REPORT_RANGES } from '../components/DateRangePicker';
import Banner from '../components/Banner';
import ErrorState from '../components/ErrorState';
import './Seo.css';

const TILES = [
  { key: 'profileViews', label: 'Profile views', sub: 'Search + Maps' },
  { key: 'searchAppearances', label: 'Search appearances', sub: 'Google Search' },
  { key: 'mapsViews', label: 'Maps views', sub: 'Google Maps' },
  { key: 'calls', label: 'Calls', sub: 'Tapped your number' },
  { key: 'websiteClicks', label: 'Website clicks', sub: 'From your profile' },
  { key: 'directionRequests', label: 'Direction requests', sub: 'Asked for the route' }
];

function Stars({ rating }) {
  if (rating == null) return null;
  return (
    <span className="gbp-stars" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= Math.round(rating) ? 'gbp-star on' : 'gbp-star'} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

function Review({ review, isDemo, onReplied }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');

  async function send() {
    if (!text.trim() || state === 'saving') return;
    setState('saving');
    setError('');
    try {
      await api.replyReview(review.id, text.trim());
      setState('idle');
      setReplying(false);
      onReplied(review.id, text.trim());
    } catch (err) {
      setState('idle');
      setError(err.message);
    }
  }

  return (
    <li className="card gbp-review">
      <div className="gbp-review-head">
        <span className="gbp-review-name">{review.reviewer}</span>
        <Stars rating={review.rating} />
        <span className="gbp-review-date">{fmtDate(review.createTime.slice(0, 10))}</span>
      </div>
      {review.comment && <p className="gbp-review-text">{review.comment}</p>}
      {review.reply ? (
        <div className="gbp-review-reply">
          <span className="gbp-review-reply-label">Your reply</span>
          <p>{review.reply}</p>
        </div>
      ) : replying ? (
        <div className="gbp-reply-form">
          <textarea
            className="gbp-reply-input"
            rows="3"
            placeholder="Write a short, personal reply…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && <p className="gbp-reply-error">{error}</p>}
          <div className="gbp-reply-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setReplying(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!text.trim() || state === 'saving'} onClick={send}>
              {state === 'saving' ? 'Posting…' : 'Post reply'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-secondary gbp-reply-open"
          disabled={isDemo}
          title={isDemo ? 'Connect your Business Profile to reply' : undefined}
          onClick={() => setReplying(true)}
        >
          Reply
        </button>
      )}
    </li>
  );
}

export default function Seo() {
  const [view, setView] = useState('last_30d');
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);
  const [data, setData] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickBusy, setPickBusy] = useState(false);
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
      setStatus(s);
    } catch (err) {
      setStatusError(err.message);
    }
  }, []);

  const loadData = useCallback(async (nextView) => {
    const requestId = ++viewRequestId.current;
    setDataError(null);
    setRefreshing(true);
    try {
      const result = await api.getGbp(nextView);
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
  }, [loadStatus]);
  useEffect(() => {
    loadData(view);
  }, [view, loadData]);

  if (redirecting) return null;

  async function pickLocation(locationId) {
    setPickBusy(true);
    try {
      await api.selectGbpLocation(locationId);
      await loadData(view);
    } finally {
      setPickBusy(false);
    }
  }

  const onReplied = (reviewId, text) =>
    setData((d) => ({
      ...d,
      reviews: d.reviews.map((r) => (r.id === reviewId ? { ...r, reply: text } : r))
    }));

  return (
    <div className="seo-page">
      <TopNav email={status?.email} />

      <main className="seo-main">
        <div className="seo-head">
          <h1>Local SEO</h1>
          <DateRangePicker value={view} onChange={setView} allowCustom presets={REPORT_RANGES} />
        </div>

        {data?.state === 'ok' && (
          <div className="seo-subhead">
            <span className="seo-site">{data.isDemo ? 'Sample business' : data.locationName}</span>
            <span className="filter-period">
              {fmtDate(data.since)} – {fmtDate(data.until)}
            </span>
          </div>
        )}

        {statusError && <ErrorState message={statusError} onRetry={loadStatus} />}
        {dataError && <ErrorState message={dataError} onRetry={() => loadData(view)} />}

        {data?.isDemo && (
          <Banner tone="info">
            This is sample data. Connect your Google Business Profile to manage your real presence and
            reviews.
          </Banner>
        )}

        {data?.isDemo && (
          <div className="card seo-notice">
            <p>Connect Google Business Profile</p>
            <p className="seo-notice-sub">
              A separate one-time Google consent (read/manage your Business Profile). Heads up: Google
              gates Business Profile API access behind an approval form — data appears once your access
              request is approved.
            </p>
            <a className="btn btn-primary seo-notice-action" href="/.netlify/functions/auth-gbp">
              Connect Business Profile
            </a>
          </div>
        )}

        {!data && !dataError && (
          <div className="card seo-loading" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton seo-skeleton-row" />
            ))}
          </div>
        )}

        {data?.state === 'api-pending' && (
          <div className="card seo-notice">
            <p>Business Profile API access is pending Google approval.</p>
            <p className="seo-notice-sub">
              Your profile is connected, but Google grants Business Profile API access per project via an
              access-request form (new projects start with zero quota). Submit the request in the Google
              Cloud console for this app's project, then check back — no reconnect needed.
            </p>
            <button type="button" className="btn btn-primary seo-notice-action" onClick={() => loadData(view)}>
              Check again
            </button>
          </div>
        )}

        {data?.state === 'needs-location' && (
          <div className="card seo-notice">
            <p>Which location should Pulse manage?</p>
            <ul className="seo-property-list">
              {data.properties.map((p) => (
                <li key={p.id}>
                  <button type="button" className="seo-property-option" disabled={pickBusy} onClick={() => pickLocation(p.id)}>
                    <span className="seo-property-url">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data?.state === 'unavailable' && (
          <ErrorState
            message="Couldn't fetch Business Profile data right now — please try again in a moment."
            onRetry={() => loadData(view)}
          />
        )}

        {data?.state === 'ok' && (
          <div className={`seo-body${refreshing ? ' is-refreshing' : ''}`}>
            {data.metrics && (
              <div className="gbp-band">
                {TILES.map((t) => (
                  <div key={t.key} className="card gbp-tile">
                    <span className="gbp-tile-label">{t.label}</span>
                    <span className="gbp-tile-value">{number(data.metrics[t.key])}</span>
                    <span className="gbp-tile-sub">{t.sub}</span>
                  </div>
                ))}
              </div>
            )}

            <section className="seo-section">
              <div className="gbp-reviews-head">
                <h2>Recent reviews</h2>
                {data.averageRating != null && (
                  <span className="gbp-rating-summary">
                    <Stars rating={data.averageRating} /> {data.averageRating.toFixed(1)} ·{' '}
                    {number(data.totalReviewCount)} reviews
                  </span>
                )}
              </div>
              {data.reviews.length === 0 ? (
                <p className="seo-footnote">No reviews in view yet.</p>
              ) : (
                <ul className="gbp-review-list">
                  {data.reviews.map((r) => (
                    <Review key={r.id} review={r} isDemo={data.isDemo} onReplied={onReplied} />
                  ))}
                </ul>
              )}
            </section>

            <p className="seo-footnote">
              Data from your Google Business Profile. Replies you post here publish publicly on Google.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
