import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// The master metrics setup - run once at onboarding, re-run only from
// Settings. Three steps on top of the always-on defaults (Spend, CPM,
// Impressions, Ad Clicks, CTR, CPC - never selectable, no UI to remove):
//   1 "Anything else you want to see?"  - optional non-conversion extras
//   2 "Which results matter to you?"    - real conversion events w/ counts;
//                                         picking one implies its Cost per
//   3 "What counts as a result?"        - ONE event per platform, named
//                                         (default "Enquiries")
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

  const toggle = (set, setter) => (key) =>
    setter((cur) => {
      const next = new Set(cur);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const platforms = ['meta', 'google'];
  const eventsFor = (p) => (events || []).filter((e) => e.platform === p);

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
      <div className="scard mp-card">
        <p className="section-sub">Step {step} of 3</p>

        {step === 1 && (
          <>
            <h2 className="section-title">Anything else you want to see?</h2>
            <p className="section-sub" style={{ marginTop: 4 }}>
              You always get spend, impressions, clicks and their costs. Add any of these on top — or skip.
            </p>
            <div className="mp-group">
              {EXTRAS.map((m) => (
                <button key={m.id} type="button" className={`qchip${extras.has(m.id) ? ' c-cobalt' : ''}`} aria-pressed={extras.has(m.id)} onClick={() => toggle(extras, setExtras)(m.id)}>
                  {extras.has(m.id) ? '✓ ' : ''}{m.label}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="section-title">Which results matter to you?</h2>
            <p className="section-sub" style={{ marginTop: 4 }}>
              These are the actions your accounts already track. Pick the ones you care about — the cost of each comes
              with it automatically.
            </p>
            {events === null && <p className="section-sub" style={{ marginTop: 12 }}>Checking what your accounts track…</p>}
            {events && events.length === 0 && (
              <p className="section-sub" style={{ marginTop: 12 }}>
                No tracked conversions found yet — connect Meta or Google in Settings and re-run this setup.
              </p>
            )}
            {platforms.map((p) =>
              eventsFor(p).length ? (
                <div key={p} style={{ marginTop: 12 }}>
                  <span className="plat">
                    <span className={`dot ${p}`} />
                    {p === 'meta' ? 'Meta' : 'Google'}
                  </span>
                  <div className="mp-group">
                    {eventsFor(p).map((e) => {
                      const key = `${e.platform}:${e.id}`;
                      return (
                        <button key={key} type="button" className={`qchip${conversions.has(key) ? ' c-cobalt' : ''}`} aria-pressed={conversions.has(key)} onClick={() => toggle(conversions, setConversions)(key)}>
                          {conversions.has(key) ? '✓ ' : ''}{e.label}
                          {e.count != null && e.count > 0 && (
                            <span className="cache-note" style={{ marginLeft: 4 }}>{e.count.toLocaleString()} in the last 90 days</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="section-title">What counts as a result?</h2>
            <p className="section-sub" style={{ marginTop: 4 }}>
              Pick ONE per platform — this becomes your headline number everywhere. Meta and Google count different
              things, so Pulse shows one blended total and explains the split.
            </p>
            {platforms.map((p) =>
              eventsFor(p).length ? (
                <div key={p} style={{ marginTop: 12 }}>
                  <span className="plat">
                    <span className={`dot ${p}`} />
                    {p === 'meta' ? 'Meta' : 'Google'}
                  </span>
                  <div className="mp-group">
                    {eventsFor(p).map((e) => (
                      <button key={e.id} type="button" className={`qchip${primary[p] === e.id ? ' c-cobalt' : ''}`} aria-pressed={primary[p] === e.id} onClick={() => setPrimary((cur) => ({ ...cur, [p]: cur[p] === e.id ? null : e.id }))}>
                        {primary[p] === e.id ? '✓ ' : ''}{e.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null
            )}
            <label className="section-sub" style={{ display: 'block', marginTop: 14 }} htmlFor="mo-name">
              What should we call them?
            </label>
            <input id="mo-name" className="budget-input" style={{ width: 220, marginTop: 6 }} value={resultName} onChange={(e) => setResultName(e.target.value)} />
          </>
        )}

        {error && <p className="section-sub" style={{ color: 'var(--red)', marginTop: 10 }}>{error}</p>}
        <div className="mp-foot">
          {!forced && step === 1 && (
            <button type="button" className="sbtn sbtn-ghost" onClick={onClose}>Cancel</button>
          )}
          {step > 1 && (
            <button type="button" className="sbtn sbtn-ghost" onClick={() => setStep(step - 1)}>Back</button>
          )}
          {step < 3 && (
            <button type="button" className="sbtn sbtn-primary" onClick={() => setStep(step + 1)}>
              {step === 1 && extras.size === 0 ? 'Skip' : 'Next'}
            </button>
          )}
          {step === 3 && (
            <button type="button" className="sbtn sbtn-primary" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Finish setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
