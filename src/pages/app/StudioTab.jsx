import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useShell } from '../../components/Shell';

// Leadly Studio, built from scratch: exactly four inputs (reference images,
// a brief file, the prompt, the overlay line), a template + placement +
// variants + model strip, and one Generate button with the exact cost on
// it. The spec writing, generation, compositing and QA all happen
// server-side with no approval steps; this page just collects inputs,
// polls the job, and shows the storage-backed gallery.

const sgd = (v) => '$' + (v || 0).toFixed(2);

function TemplateThumb({ t, selected, onClick }) {
  // a miniature of the template: photo area, brand surfaces, text zone
  const W = 72;
  const H = 72;
  const r = t.imageRect || { x: 0, y: 0, w: 1, h: 1 };
  const z = t.zone;
  return (
    <button type="button" className={`st-thumb${selected ? ' on' : ''}`} onClick={onClick} title={t.name} aria-pressed={selected}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <rect x="0" y="0" width={W} height={H} rx="6" fill="var(--cobalt)" />
        <rect x={r.x * W} y={r.y * H} width={r.w * W} height={r.h * H} fill="#C7CFDA" />
        <rect x={z.x * W} y={z.y * H} width={z.w * W} height={z.h * H} rx="2" fill="rgba(255,255,255,.85)" stroke="var(--cobalt)" strokeDasharray="3 2" />
        {t.logoCorner && <circle cx={t.logoCorner.endsWith('right') ? W - 8 : 8} cy="8" r="3.5" fill="#fff" />}
      </svg>
      <span>{t.name}</span>
    </button>
  );
}

function CreditsBar({ credits, role }) {
  const client = role === 'client' || role === 'member';
  const frac = client ? credits.usedFrac : credits.budget > 0 ? Math.min(1, credits.monthSpend / credits.budget) : 0;
  return (
    <div className="st-credits scard">
      <div className="st-credits-copy">
        <span className="kpi-label">Credits used this month</span>
        {!client && (
          <span className="section-sub">
            {sgd(credits.monthSpend)} of {sgd(credits.budget)} — {sgd(credits.remaining)} left
          </span>
        )}
      </div>
      <div className="st-bar" role="img" aria-label="Credits used">
        <div className="st-bar-fill" style={{ width: `${Math.round(frac * 100)}%`, background: frac >= 1 ? 'var(--red)' : frac > 0.85 ? 'var(--amber)' : 'var(--cobalt)' }} />
      </div>
    </div>
  );
}

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

export default function StudioTab() {
  const { status, toast } = useShell();
  const email = status?.email || '';
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);

  // the four inputs
  const [refs, setRefs] = useState([]); // [{name, dataUrl}]
  const [brief, setBrief] = useState(null); // {name, data}
  const [prompt, setPrompt] = useState('');
  const [overlay, setOverlay] = useState('');

  // the strip
  const [templateId, setTemplateId] = useState('open-left');
  const [placements, setPlacements] = useState(['square']);
  const [variants, setVariants] = useState(1);
  const [model, setModel] = useState('nano-banana-pro');

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [assets, setAssets] = useState(null);
  const [editing, setEditing] = useState(null); // metaPath being edited
  const [editText, setEditText] = useState('');
  const pollRef = useRef(null);

  const overlayMax = config?.overlayMax || 60;

  useEffect(() => {
    api.studioConfig().then(setConfig).catch((err) => setError(err.message));
    api.studioGallery().then((r) => setAssets(r.assets || [])).catch(() => setAssets([]));
    // a reload resumes the last job's progress
    try {
      const last = localStorage.getItem(`studio-job:${email}`);
      if (last) pollJob(last);
    } catch {
      // storage unavailable
    }
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const pollJob = useCallback((jobId) => {
    clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const r = await api.studioJob(jobId);
        setJob(r.job);
        if (['done', 'partial', 'error'].includes(r.job.status)) {
          clearInterval(pollRef.current);
          api.studioGallery().then((g) => setAssets(g.assets || [])).catch(() => {});
        }
      } catch {
        clearInterval(pollRef.current);
      }
    };
    tick();
    pollRef.current = setInterval(tick, 2500);
  }, []);

  const price = useMemo(() => (config?.models || []).find((m) => m.id === model)?.price || 0, [config, model]);
  const cost = +(placements.length * variants * price).toFixed(2);
  const credits = config?.credits;
  const isClient = config && (config.role === 'client' || config.role === 'member');
  const overBudget = credits && !isClient && cost > (credits.remaining ?? Infinity);
  const exhausted = credits?.exhausted;

  const addRefs = async (files) => {
    const next = [...refs];
    for (const f of [...files].slice(0, 3 - refs.length)) {
      next.push({ name: f.name, dataUrl: await readFileAsDataUrl(f) });
    }
    setRefs(next.slice(0, 3));
  };

  const addBrief = async (file) => {
    if (!file) return;
    if (!/\.(md|txt|csv|json|pdf)$/i.test(file.name)) return toast('Only .md, .txt, .csv, .json and .pdf files.');
    setBrief({ name: file.name, data: await readFileAsDataUrl(file) });
  };

  const generate = async () => {
    setBusy(true);
    try {
      const r = await api.studioGenerate({
        prompt: prompt.trim(),
        overlayText: overlay,
        refs: refs.map((x) => x.dataUrl),
        file: brief,
        templateId,
        placements,
        variants,
        model
      });
      setConfirming(false);
      try {
        localStorage.setItem(`studio-job:${email}`, r.jobId);
      } catch {
        // storage unavailable
      }
      toast(`Charged ${sgd(r.cost)} — generating.`);
      pollJob(r.jobId);
      api.studioConfig().then(setConfig).catch(() => {});
    } catch (err) {
      setConfirming(false);
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const retryFrame = async (key) => {
    try {
      await api.studioAsset({ action: 'retry', jobId: job.id, key });
      pollJob(job.id);
    } catch (err) {
      toast(err.message);
    }
  };

  const saveOverlayEdit = async (asset) => {
    try {
      const r = await api.studioAsset({ action: 'edit_overlay', metaPath: asset.metaPath, text: editText });
      // cache-bust only real URLs - data:/mock: URLs would become invalid
      const fresh = /^https?:/.test(r.url) ? `${r.url}${r.url.includes('?') ? '&' : '?'}v=${Date.now()}` : r.url;
      setAssets((cur) => cur.map((a) => (a.metaPath === asset.metaPath ? { ...a, overlay: { ...a.overlay, text: r.text }, url: fresh } : a)));
      setEditing(null);
      toast('Overlay updated — no new generation charged.');
    } catch (err) {
      toast(err.message);
    }
  };

  const saveToLibrary = async (asset) => {
    try {
      await api.studioAsset({ action: 'save', metaPath: asset.metaPath });
      setAssets((cur) => cur.map((a) => (a.metaPath === asset.metaPath ? { ...a, saved: true } : a)));
      toast('Saved to your library.');
    } catch (err) {
      toast(err.message);
    }
  };

  if (error) {
    return <div className="scard" style={{ padding: 16 }}><span className="section-sub">Studio couldn’t load: {error}</span></div>;
  }
  if (!config) {
    return <div className="scard" style={{ padding: 24 }}><div className="skeleton" style={{ height: 160 }} /></div>;
  }

  // locked until the platform admin flips the workspace's Studio flag
  if (!config.enabled) {
    return (
      <div className="locked-wrap">
        <div className="locked-overlay">
          <div className="locked-card">
            <div className="lock-ico">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </div>
            <h3>Studio is coming soon</h3>
            <p>Your ad creator is being polished. Pulse will let you know the moment it&rsquo;s ready.</p>
          </div>
        </div>
        <div className="locked-content" aria-hidden="true">
          <div className="scard" style={{ height: 320 }} />
        </div>
      </div>
    );
  }

  const frames = job ? Object.entries(job.placements || {}) : [];

  return (
    <>
      {credits && <CreditsBar credits={credits} role={config.role} />}

      <div className="scard st-panel">
        <h2 className="section-title" style={{ marginBottom: 4 }}>Create an ad</h2>
        <p className="section-sub" style={{ marginBottom: 14 }}>Four inputs. Everything else is automatic.</p>

        {/* a. reference images */}
        <label className="st-label">Reference images <span className="section-sub">optional, up to 3</span></label>
        <div className="st-refs">
          {refs.map((r, i) => (
            <span key={i} className="st-ref">
              <img src={r.dataUrl} alt={r.name} />
              <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setRefs(refs.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {refs.length < 3 && (
            <label className="st-ref-add">
              +
              <input type="file" accept="image/*" multiple hidden onChange={(e) => addRefs(e.target.files)} aria-label="Upload reference images" />
            </label>
          )}
        </div>

        {/* b. brief file */}
        <label className="st-label">Brief file <span className="section-sub">optional — .md .txt .csv .json .pdf</span></label>
        {brief ? (
          <span className="fchip" style={{ alignSelf: 'flex-start' }} onClick={() => setBrief(null)} role="button" title="Remove file">
            {brief.name} ×
          </span>
        ) : (
          <label className="sbtn sbtn-ghost sbtn-sm" style={{ alignSelf: 'flex-start', cursor: 'pointer' }}>
            Upload a file
            <input type="file" accept=".md,.txt,.csv,.json,.pdf" hidden onChange={(e) => addBrief(e.target.files[0])} aria-label="Upload brief file" />
          </label>
        )}

        {/* c. prompt */}
        <label className="st-label" htmlFor="st-prompt">Prompt</label>
        <textarea
          id="st-prompt"
          className="st-prompt"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="retirement ad, warm family at HDB void deck, golden hour"
        />

        {/* d. overlay text - hard 60-char cap */}
        <label className="st-label" htmlFor="st-overlay">
          Overlay text
          <span className={`st-counter${overlay.length >= overlayMax ? ' max' : ''}`}>{overlay.length}/{overlayMax}</span>
        </label>
        <input
          id="st-overlay"
          className="st-overlay"
          type="text"
          maxLength={overlayMax}
          value={overlay}
          onChange={(e) => setOverlay(e.target.value.slice(0, overlayMax))}
          placeholder="Retirement, planned properly."
        />
        <p className="section-sub" style={{ marginTop: 4 }}>The words that appear on the ad. Short sells.</p>

        {/* the strip */}
        <label className="st-label" style={{ marginTop: 16 }}>Template</label>
        <div className="st-thumbs">
          {(config.templates || []).map((t) => (
            <TemplateThumb key={t.id} t={t} selected={templateId === t.id} onClick={() => setTemplateId(t.id)} />
          ))}
        </div>

        <div className="st-strip">
          <div>
            <span className="st-label">Placements</span>
            <div className="mp-group" style={{ marginTop: 6 }}>
              {(config.placements || []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`qchip${placements.includes(p.id) ? ' c-cobalt' : ''}`}
                  aria-pressed={placements.includes(p.id)}
                  onClick={() => setPlacements((cur) => (cur.includes(p.id) ? (cur.length > 1 ? cur.filter((x) => x !== p.id) : cur) : [...cur, p.id]))}
                >
                  {p.ratio} {p.label.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="st-label">Variants</span>
            <div className="seg" style={{ marginTop: 6 }}>
              {[1, 2, 3, 4].map((n) => (
                <button key={n} type="button" className={variants === n ? 'on' : ''} onClick={() => setVariants(n)}>{n}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="st-label">Model</span>
            <select className="filter-select" style={{ marginTop: 6, display: 'block' }} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
              {(config.models || []).map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {sgd(m.price)}/image</option>
              ))}
            </select>
          </div>
          <div style={{ marginLeft: 'auto', alignSelf: 'flex-end' }}>
            <button
              type="button"
              className="sbtn sbtn-primary"
              disabled={busy || !prompt.trim() || exhausted || overBudget}
              onClick={() => setConfirming(true)}
            >
              Generate — {sgd(cost)}
            </button>
            {(exhausted || overBudget) && (
              <p className="st-budget-warn" role="alert">
                {exhausted ? 'Monthly credits are used up.' : `Needs ${sgd(cost)} — only ${sgd(credits.remaining)} left.`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* confirm sheet before charging */}
      {confirming && (
        <div className="mp-overlay" role="dialog" aria-label="Confirm generation">
          <div className="scard mp-card mo-card" style={{ maxWidth: 440 }}>
            <h2 className="mo-title">Generate {placements.length * variants} image{placements.length * variants > 1 ? 's' : ''}?</h2>
            <p className="mo-sub">
              {placements.length} placement{placements.length > 1 ? 's' : ''} × {variants} variant{variants > 1 ? 's' : ''} on {model}.
              This charges <b>{sgd(cost)}</b> of the workspace&rsquo;s monthly credit.
            </p>
            <div className="mp-foot">
              <button type="button" className="sbtn sbtn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="sbtn sbtn-primary" disabled={busy} onClick={generate}>
                {busy ? 'Starting…' : `Charge ${sgd(cost)} & generate`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* live job */}
      {job && (
        <>
          <div className="section-head">
            <span className="section-title">Current job</span>
            <span className="section-sub">{job.status === 'generating' || job.status === 'queued' ? 'Working…' : `Finished: ${job.status}`}</span>
          </div>
          <div className="st-frames">
            {frames.map(([key, f]) => (
              <div key={key} className="scard st-frame">
                <span className="st-frame-key">{key.replace(':', ' · v')}</span>
                {f.status === 'done' && <img src={f.url} alt={key} />}
                {(f.status === 'queued' || f.status === 'generating') && <div className="skeleton" style={{ height: 120 }} />}
                {f.status === 'error' && (
                  <div className="st-frame-err">
                    <span className="section-sub">{f.error}</span>
                    <button type="button" className="sbtn sbtn-ghost sbtn-sm" onClick={() => retryFrame(key)}>Retry this frame</button>
                  </div>
                )}
                {f.rung && f.rung !== 'original' && <span className="pill warn st-rung">auto-fixed: {f.rung}</span>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* gallery: storage is the source of truth */}
      <div className="section-head">
        <span className="section-title">Gallery</span>
        <span className="section-sub">Every ad this workspace has made</span>
      </div>
      {assets === null && <div className="scard" style={{ padding: 24 }}><div className="skeleton" style={{ height: 120 }} /></div>}
      {assets && assets.length === 0 && (
        <div className="scard" style={{ padding: 20 }}>
          <span className="section-sub">Nothing yet — your first ad lands here.</span>
        </div>
      )}
      {assets && assets.length > 0 && (
        <div className="st-gallery">
          {assets.map((a) => (
            <div key={a.metaPath} className="scard st-asset">
              <img src={a.url} alt={a.overlay.text || a.placementId} loading="lazy" />
              <div className="st-asset-body">
                <span className="st-asset-text">{a.overlay.text || '—'}</span>
                <span className="section-sub">{a.placementId}{a.saved ? ' · saved' : ''}{a.rung && a.rung !== 'original' ? ` · ${a.rung}` : ''}</span>
                {editing === a.metaPath ? (
                  <div className="st-edit-row">
                    <input
                      type="text"
                      maxLength={overlayMax}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value.slice(0, overlayMax))}
                      aria-label="New overlay text"
                    />
                    <button type="button" className="sbtn sbtn-primary sbtn-sm" onClick={() => saveOverlayEdit(a)}>Save</button>
                    <button type="button" className="sbtn sbtn-ghost sbtn-sm" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className="st-asset-actions">
                    <a className="sbtn sbtn-ghost sbtn-sm" href={a.url} download>Download</a>
                    <button type="button" className="sbtn sbtn-ghost sbtn-sm" onClick={() => { setEditing(a.metaPath); setEditText(a.overlay.text || ''); }}>
                      Edit text
                    </button>
                    {!a.saved && (
                      <button type="button" className="sbtn sbtn-ghost sbtn-sm" onClick={() => saveToLibrary(a)}>Save</button>
                    )}
                    <a className="sbtn sbtn-ghost sbtn-sm" href="/campaigns.html">→ Campaigns</a>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
