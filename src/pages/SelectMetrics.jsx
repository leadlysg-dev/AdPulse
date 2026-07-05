import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import ErrorState from '../components/ErrorState';
import { number } from '../lib/format';
import './SelectMetrics.css';

const MAX_METRICS = 10;

export default function SelectMetrics() {
  const [params] = useSearchParams();
  const provider = params.get('provider') === 'google' ? 'google' : 'meta';
  const providerLabel = provider === 'meta' ? 'Meta' : 'Google';

  const [groups, setGroups] = useState(null);
  const [available, setAvailable] = useState(true);
  const [checked, setChecked] = useState(new Set());
  const [hasSavedSelection, setHasSavedSelection] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const allOptions = useMemo(
    () => (groups ? groups.flatMap((g) => g.options) : []),
    [groups]
  );

  async function load() {
    setError(null);
    setGroups(null);
    try {
      const data = await api.listMetrics(provider);
      setAvailable(data.available);
      setGroups(data.groups);
      setHasSavedSelection(!!data.hasSavedSelection);
      // Pre-check the saved selection; for first-time setup that's the
      // Leads default, which is a sensible starting point.
      setChecked(new Set(data.selected));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  function toggle(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_METRICS) next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const metrics = allOptions
        .filter((o) => checked.has(o.id))
        .map((o) => ({ id: o.id, label: o.label }));
      await api.selectMetrics(provider, metrics);
      window.location.href = '/dashboard.html';
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="select-metrics-page">
      <div className="select-metrics-card card">
        <h1>Which results matter to your business?</h1>
        <p className="select-metrics-sub">
          Pick the conversions you want on your dashboard — as many as apply. A gym might track
          purchases, a clinic appointments, an agency leads. You can change this anytime.
          The first one you pick becomes your headline number.
        </p>

        {error && <ErrorState message={error} onRetry={load} />}

        {!error && groups === null && (
          <div className="select-metrics-list">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton select-metrics-skeleton-row" />
            ))}
          </div>
        )}

        {!error && groups !== null && !available && (
          <div className="select-metrics-unavailable">
            <p>{providerLabel} conversion metrics aren't available yet — live {providerLabel} data is
            coming soon. Your {providerLabel} account stays connected in the meantime.</p>
            <Link className="btn btn-secondary" to="/dashboard.html">
              Back to dashboard
            </Link>
          </div>
        )}

        {!error && groups !== null && available && (
          <>
            <div className="select-metrics-groups">
              {groups.map((group) => (
                <section key={group.id} className="metric-group">
                  <h2 className="metric-group-heading">{group.label}</h2>
                  <div className="select-metrics-list" role="group" aria-label={group.label}>
                    {group.options.map((opt) => {
                      const isChecked = checked.has(opt.id);
                      return (
                        <label
                          key={opt.id}
                          className={`metric-option${isChecked ? ' selected' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggle(opt.id)}
                          />
                          <span className="metric-check" aria-hidden="true">
                            {isChecked && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          <span className="metric-label">{opt.label}</span>
                          <span className="metric-count">
                            {opt.count90d > 0 ? `${number(opt.count90d)} in last 90 days` : 'No recent activity'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="select-metrics-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={checked.size === 0 || saving}
                onClick={handleSave}
              >
                {saving ? 'Saving…' : `Track ${checked.size} metric${checked.size === 1 ? '' : 's'}`}
              </button>
              {/* First-time setup has nothing to fall back to - the dashboard
                  would just bounce back here - so Cancel only shows for edits. */}
              {hasSavedSelection && (
                <Link className="select-metrics-cancel" to="/dashboard.html">
                  Cancel
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
