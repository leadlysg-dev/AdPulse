import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// The master metrics setup - run once at onboarding, re-run only from
// Settings. Two steps on top of the always-on defaults (Spend, CPM,
// Impressions, Ad Clicks, CTR, CPC - never selectable, no UI to remove):
//   1 "Anything else you want to see?"    - optional non-conversion extras
//   2 "Which results should Pulse count?" - tick the real conversion events
//     that matter (each brings its Cost per), and star ONE per platform as
//     the headline result, named for the client (default "Enquiries").
export const EXTRAS = [
  { id: 'reach', label: 'Reach' },
  { id: 'frequency', label: 'Frequency' },
  { id: 'video_views', label: 'Video views' },
  { id: 'thruplays', label: 'ThruPlays' },
  { id: 'engagement', label: 'Engagement' }
];

export default function MetricsOnboarding({ initial, onSaved, onClose, forced }) {
  const [step, setStep] = useState(1);
  const [extras, setExtras] = useState(() => new Set(initial?.extras || []));
  const [events, setEvents] = useState(null); // [{id,label,platform,count}]
  const [conversions, setConversions] = useState(() => new Set((initial?.conversions || []).map((c) => `${c.platform}:${c.id}`)));
  const [primary, setPrimary] = useState(() => ({
    meta: initial?.primaryResult?.meta?.event || null,
    google: initial?.primaryResult?.google?.event || null
  }));
  const [resultName, setResultName] = useState(initial?.primaryResult?.name || 'Enquiries');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // every conversion event with tracked data, straight from the platforms
    Promise.all([api.listMetrics('meta').catch(() => null), api.listMetrics('google').catch(() => null)]).then(
      ([meta, google]) => {
        if (cancelled) return;
        // list-metrics returns grouped conversion options with 90-day counts
        const list = [];
        for (const [platform, r] of [['meta', meta], ['google', google]]) {
          for (const g of r?.groups || []) {
            for (const o of g.options || []) {
              list.push({ id: o.id, label: o.label || o.id, platform, count: o.count90d ?? null });
            }
          }
        }
        setEvents(list.slice(0, 60));
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleExtra = (key) =>
    setExtras((cur) => {
      const next = new Set(cur);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const platforms = ['meta', 'google'];
  const eventsFor = (p) => (events || []).filter((e) => e.platform === p);

  const toggleConversion = (e) => {
    const key = `${e.platform}:${e.id}`;
    setConversions((cur) => {
      const next = new Set(cur);
      if (next.has(key)) {
        next.delete(key);
        // un-ticking the headline clears the star too
        setPrimary((p) => (p[e.platform] === e.id ? { ...p, [e.platform]: null } : p));
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const setHeadline = (e) => {
    // starring an event also ticks it
    setConversions((cur) => new Set(cur).add(`${e.platform}:${e.id}`));
    setPrimary((p) => ({ ...p, [e.platform]: p[e.platform] === e.id ? null : e.id }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const config = {
        extras: [...extras],
        conversions: (events || [])
          .filter((e) => conversions.has(`${e.platform}:${e.id}`))
          .map((e) => ({ id: e.id, label: e.label, platform: e.platform })),
        primaryResult: {
          name: resultName.trim() || 'Enquiries',
          source: 'platform_event',
          meta: primary.meta ? { event: primary.meta, label: eventsFor('meta').find((e) => e.id === primary.meta)?.label || primary.meta } : null,
          google: primary.google ? { event: primary.google, label: eventsFor('google').find((e) => e.id === primary.google)?.label || primary.google } : null
        }
      };
      const r = await api.metricsConfigSave(config);
      onSaved(r.config || config);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="mp-overlay" role="dialog" aria-label="Metrics setup">
      <div className="scard mp-card mo-card">
        <p className="mo-step">Step {step} of 2</p>

        {step === 1 && (
          <>
            <h2 className="mo-title">Anything else you want to see?</h2>
            <p className="mo-sub">
              You always get spend, impressions, clicks and their costs. Add any of these on top — or just skip.
            </p>
            <div className="mp-group">
              {EXTRAS.map((m) => (
                <button key={m.id} type="button" className={`qchip mo-chip${extras.has(m.id) ? ' c-cobalt' : ''}`} aria-pressed={extras.has(m.id)} onClick={() => toggleExtra(m.id)}>
                  {extras.has(m.id) ? '✓ ' : ''}{m.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="mo-title">Which results should Pulse count?</h2>
            <p className="mo-sub">
              These are the actions your accounts already track. <b>Tick</b> everything you want to see — the cost of
              each comes with it automatically. Then tap <b>★ Headline</b> on the ONE that matters most on each
              platform: that becomes the big number at the top of every page.
            </p>
            {events === null && <p className="mo-sub" style={{ marginTop: 12 }}>Checking what your accounts track…</p>}
            {events && events.length === 0 && (
              <p className="mo-sub" style={{ marginTop: 12 }}>
                No tracked conversions found yet — connect Meta or Google in Settings and re-run this setup.
              </p>
            )}
            {platforms.map((p) =>
              eventsFor(p).length ? (
                <div key={p} className="mo-platform">
                  <span className="mo-plat-head">
                    <span className={`dot ${p}`} />
                    {p === 'meta' ? 'Meta' : 'Google'}
                  </span>
                  <div className="mo-list">
                    {eventsFor(p).map((e) => {
                      const key = `${e.platform}:${e.id}`;
                      const on = conversions.has(key);
                      const star = primary[p] === e.id;
                      return (
                        <div key={key} className={`mo-row${on ? ' on' : ''}${star ? ' star' : ''}`}>
                          <button type="button" className="mo-tick" role="checkbox" aria-checked={on} aria-label={`Track ${e.label}`} onClick={() => toggleConversion(e)}>
                            <span className={`cb${on ? ' on' : ''}`} />
                            <span className="mo-label">{e.label}</span>
                            {e.count != null && e.count > 0 && <span className="mo-count">{e.count.toLocaleString()} in the last 90 days</span>}
                          </button>
                          <button type="button" className={`mo-star${star ? ' on' : ''}`} aria-pressed={star} title="Make this the headline result" onClick={() => setHeadline(e)}>
                            ★ Headline
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null
            )}
            <label className="mo-name-label" htmlFor="mo-name">
              What should we call your headline result?
            </label>
            <p className="mo-sub" style={{ marginTop: 2 }}>This word shows everywhere — “Enquiries”, “Leads”, “Bookings”…</p>
            <input id="mo-name" className="budget-input mo-name" value={resultName} onChange={(e) => setResultName(e.target.value)} />
          </>
        )}

        {error && <p className="mo-error" role="alert">{error}</p>}
        <div className="mp-foot">
          {!forced && step === 1 && (
            <button type="button" className="sbtn sbtn-ghost" onClick={onClose}>Cancel</button>
          )}
          {step > 1 && (
            <button type="button" className="sbtn sbtn-ghost" onClick={() => setStep(step - 1)}>Back</button>
          )}
          {step === 1 && (
            <button type="button" className="sbtn sbtn-primary" onClick={() => setStep(2)}>
              {extras.size === 0 ? 'Skip' : 'Next'}
            </button>
          )}
          {step === 2 && (
            <button type="button" className="sbtn sbtn-primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Finish setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
