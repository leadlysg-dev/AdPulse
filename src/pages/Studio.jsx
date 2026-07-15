import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import TopNav from '../components/TopNav';
import ErrorState from '../components/ErrorState';
import './Studio.css';

// Leadly Studio - the creative generation workspace, ported from the
// standalone Creative Studio. The board renders from the job record the
// backend keeps in the store: kill the tab mid-job, reopen it, and it picks
// straight back up. Prices shown here mirror the server registry.
const money = (v) => '$' + (v || 0).toFixed(2);

const P = {
  'gpt-image-2': (q) => ({ low: 0.03, medium: 0.1, high: 0.37 })[q] ?? 0.1,
  'nano-banana-pro': () => 0.15,
  'nano-banana-edit': () => 0.15,
  'gpt-image-2-edit': (q) => ({ low: 0.03, medium: 0.1, high: 0.37 })[q] ?? 0.1,
  'veo-3.1-fast': (q, d, a) => (a ? 0.2 : 0.1) * d,
  'veo-3.1': (q, d, a) => (a ? 0.4 : 0.2) * d,
  'kling-3-pro': (q, d, a) => (a ? 0.168 : 0.112) * d,
  'kling-2.1': (q, d) => 0.25 + 0.05 * Math.max(0, d - 5)
};

const NO_TEXT_NEG = 'text, letters, words, watermarks, logos';
const TEXT_NEG =
  'watermarks, unrelated logos, gibberish text, misspelled words, duplicate or ghosted text, empty placeholder boxes';

const readFiles = (files) =>
  Promise.all(
    [...files].map(
      (f) =>
        new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res({ name: f.name, data: r.result });
          r.readAsDataURL(f);
        })
    )
  );

function Toggle({ on, onClick, title, sub }) {
  return (
    <button type="button" className={`studio-toggle${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="studio-switch" aria-hidden="true">
        <i />
      </span>
      <span className="studio-toggle-copy">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </span>
    </button>
  );
}

// The before/after slider in the editor. The original is never destroyed.
function BeforeAfter({ before, after }) {
  const wrapRef = useRef(null);
  const [pct, setPct] = useState(50);
  if (!after) {
    return (
      <div className="studio-ba-single">
        <img src={before} alt="Selected step" />
      </div>
    );
  }
  const move = (clientX) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setPct(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };
  return (
    <div
      className="studio-ba"
      ref={wrapRef}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons) move(e.clientX);
      }}
    >
      <img src={before} alt="Before" draggable="false" />
      <div className="studio-ba-after" style={{ width: `${pct}%` }}>
        <img src={after} alt="After" draggable="false" />
      </div>
      <div className="studio-ba-handle" style={{ left: `${pct}%` }} aria-hidden="true" />
      <span className="studio-ba-tag l">Before</span>
      <span className="studio-ba-tag r">After</span>
    </div>
  );
}

export default function Studio() {
  // --- session ---
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  // --- config + view ---
  const [cfg, setCfg] = useState(null);
  const [cfgError, setCfgError] = useState(null);
  const [view, setView] = useState('make');

  // --- the brief (left panel) ---
  const [kind, setKind] = useState('ad');
  const [picked, setPicked] = useState(() => new Set(['square', 'portrait', 'story', 'landscape']));
  const [motionOn, setMotionOn] = useState(false);
  const [project, setProject] = useState('untitled');
  const [promptText, setPromptText] = useState('');
  const [textModeOn, setTextModeOn] = useState(false);
  const [copyText, setCopyText] = useState('');
  const [neg, setNeg] = useState(NO_TEXT_NEG);
  const [modelId, setModelId] = useState('gpt-image-2');
  const [brandSel, setBrandSel] = useState('');
  const [variants, setVariants] = useState(1);
  const [quality, setQuality] = useState('medium');
  const [duration, setDuration] = useState(8);
  const [audioOn, setAudioOn] = useState(false);
  const [safeOn, setSafeOn] = useState(true);
  const [refs, setRefs] = useState([]);
  const [docs, setDocs] = useState([]);

  // --- money + messages ---
  const [balance, setBalance] = useState(undefined); // undefined=loading, null=unavailable
  const [balanceHint, setBalanceHint] = useState('');
  const [spend, setSpend] = useState(0);
  const [msg, setMsg] = useState(null); // { text, tone, list? }

  // --- the job on the board ---
  const [job, setJob] = useState(null);
  const [goBusy, setGoBusy] = useState(false);

  // --- prompt studio ---
  const [approved, setApproved] = useState(null);
  const [writing, setWriting] = useState(false);
  const [review, setReview] = useState(null); // { rough, prompt, negative, reasoning, cost, placement_notes }

  // --- sheets + lightbox ---
  const [confirm, setConfirm] = useState(null); // { body, total, rows, sub, warn }
  const [lightbox, setLightbox] = useState(null); // { url, video }
  const [animSheet, setAnimSheet] = useState(null); // { src, text, model, duration }

  // --- editor ---
  const [editor, setEditor] = useState(null); // { chain, src, refs, text, reason, n, busy }
  const editorOpenRef = useRef(false);
  editorOpenRef.current = !!editor;

  // --- library ---
  const [library, setLibrary] = useState(null);

  const [dropHot, setDropHot] = useState(false);

  const pollRef = useRef(0);
  const fileRef = useRef(null);
  const fileDocRef = useRef(null);
  const fileEdRef = useRef(null);

  const say = useCallback((text, tone = '', list) => setMsg(text ? { text, tone, list } : null), []);
  const addSpend = useCallback((v) => setSpend((s) => s + (v || 0)), []);

  /* ── boot ── */
  useEffect(() => {
    let cancelled = false;
    api
      .getStatus()
      .then((s) => {
        if (cancelled) return;
        if (!s.loggedIn) {
          setRedirecting(true);
          window.location.href = '/login.html';
          return;
        }
        setStatus(s);
      })
      .catch((err) => !cancelled && setStatusError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadBalance = useCallback(async () => {
    try {
      const r = await api.studioBalance();
      if (!r.ok) {
        setBalance(null);
        setBalanceHint(r.hint || '');
        return;
      }
      setBalance(Number(r.balance));
      setBalanceHint(`${r.account || ''} · ${r.currency || 'USD'}`);
    } catch {
      setBalance(null);
    }
  }, []);

  /* ── the job poll: one source of truth, read from the store ── */
  const watchJob = useCallback(
    (id) => {
      const token = ++pollRef.current;
      const tick = async () => {
        if (token !== pollRef.current) return;
        let j = null;
        try {
          const r = await api.studioJob(id);
          j = r.job || null;
          if (r.error && !j) {
            say(r.error, 'err');
            return;
          }
        } catch {
          // transient network hiccup - keep polling
        }
        if (token !== pollRef.current) return;
        if (j) {
          setJob(j);
          if (j.state === 'done' || j.state === 'partial' || j.state === 'error') {
            setGoBusy(false);
            loadBalance();
            const bad = Object.values(j.items || {}).filter((i) => i.state === 'error');
            say(
              bad.length
                ? `Finished with ${bad.length} failure${bad.length > 1 ? 's' : ''}. Each bad frame shows why, and can be retried on its own.`
                : 'Done. Every frame rendered.',
              bad.length ? 'err' : 'ok'
            );
            return;
          }
        }
        setTimeout(tick, 1400);
      };
      tick();
    },
    [loadBalance, say]
  );

  // pick the last job for this project back up
  const resume = useCallback(
    async (proj) => {
      pollRef.current++;
      try {
        const r = await api.studioJobs(proj || 'untitled');
        const j = (r.jobs || [])[0] || null;
        setJob(j);
        if (j && (j.state === 'queued' || j.state === 'generating')) {
          setGoBusy(true);
          watchJob(j.id);
        }
      } catch {
        setJob(null);
      }
    },
    [watchJob]
  );

  useEffect(() => {
    let cancelled = false;
    api
      .studioInit()
      .then((c) => {
        if (cancelled) return;
        setCfg(c);
      })
      .catch((err) => !cancelled && setCfgError(err.message));
    loadBalance();
    return () => {
      cancelled = true;
      pollRef.current++;
    };
  }, [loadBalance]);

  useEffect(() => {
    if (cfg) resume(project);
    // resume only when cfg lands or the project name is committed (onBlur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  /* ── mode ── */
  const pool = useMemo(() => {
    if (!cfg) return [];
    return kind === 'video' ? cfg.models.video : cfg.models.image;
  }, [cfg, kind]);

  const model = pool.find((m) => m.id === modelId) || pool[0] || null;

  const setKindAndDefaults = (k) => {
    setKind(k);
    const nextPool = k === 'video' ? cfg.models.video : cfg.models.image;
    const m = nextPool[0];
    setModelId(m.id);
    setQuality((m.qualities || ['medium']).includes('medium') ? 'medium' : (m.qualities || ['medium'])[0]);
    if (k === 'image') setPicked(new Set(['square']));
    if (k === 'video') setPicked(new Set(['landscape']));
    if (k === 'ad') setPicked(new Set(['square', 'portrait', 'story', 'landscape']));
  };

  const changeModel = (id) => {
    setModelId(id);
    const m = pool.find((x) => x.id === id);
    const qs = m?.qualities || ['medium'];
    if (!qs.includes(quality)) setQuality(qs.includes('medium') ? 'medium' : qs[0]);
    const durs = m?.durations || cfg?.models.animate[0]?.durations || [5, 8];
    if (!durs.includes(duration)) setDuration(durs[durs.length - 1]);
  };

  const toggleTextMode = () => {
    const on = !textModeOn;
    setTextModeOn(on);
    // the keep-out list must flip too, or you ban the very thing you asked for
    const cur = neg.trim();
    if (on && (cur === NO_TEXT_NEG || !cur)) setNeg(TEXT_NEG);
    if (!on && (cur === TEXT_NEG || !cur)) setNeg(NO_TEXT_NEG);
    setApproved(null);
    say(
      on
        ? 'Text mode on. Type the exact words below. They go into the image verbatim, and "text" is no longer blocked.'
        : 'Text mode off. The image comes back clean; your copy goes on top later.',
      'ok'
    );
  };

  /* ── price ── */
  const unit = () => (refs.length && kind !== 'video' ? (textModeOn ? 'gpt-image-2-edit' : 'nano-banana-edit') : modelId);
  const price = useMemo(() => {
    const n = Math.max(1, picked.size) * (variants || 1);
    let total = 0;
    let what = '';
    if (kind === 'video') {
      total = (P[modelId]?.(quality, duration, audioOn) || 0) * Math.max(1, picked.size);
      what = `${Math.max(1, picked.size)} × ${duration}s clip${picked.size > 1 ? 's' : ''}`;
    } else {
      total = (P[unit()]?.(quality) || 0.1) * n;
      what = `${n} image${n > 1 ? 's' : ''}`;
      if (kind === 'ad' && motionOn) {
        total += P['kling-3-pro'](quality, Math.min(duration, 10), audioOn) * n;
        what = `${n} still${n > 1 ? 's' : ''} + ${n} clip${n > 1 ? 's' : ''}`;
      }
    }
    return { total, what };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, picked, variants, quality, duration, audioOn, motionOn, modelId, refs.length, textModeOn]);

  /* ── uploads ── */
  const upload = useCallback(
    async (files, target = 'image', into = 'main') => {
      const list = [...files];
      if (!list.length) return;
      let r;
      try {
        r = await api.studioUpload(await readFiles(list), target);
      } catch (err) {
        say(err.message, 'err');
        return;
      }
      if (r.error) return say(r.error, 'err');

      if (into === 'edit') {
        setEditor((ed) => (ed ? { ...ed, refs: [...ed.refs, ...(r.saved || []).map((s) => s.url)] } : ed));
        return;
      }
      if (r.saved?.length) setRefs((cur) => [...cur, ...r.saved.map((s) => s.url)]);
      if (r.docs?.length) setDocs((cur) => [...cur, ...r.docs]);
      if (r.brands?.length) {
        setCfg((c) => ({ ...c, brands: [...new Set([...(c.brands || []), ...r.brands])] }));
        setBrandSel(r.brands[0]);
      }
      const bits = [];
      if (r.saved?.length) bits.push(`${r.saved.length} image${r.saved.length > 1 ? 's' : ''}`);
      if (r.docs?.length)
        bits.push(
          `${r.docs.length} file${r.docs.length > 1 ? 's' : ''} (${r.docs.reduce((a, d) => a + d.chars, 0).toLocaleString()} chars)`
        );
      if (r.brands?.length) bits.push(`brand: ${r.brands[0]}`);
      const text = bits.length ? `Attached: ${bits.join(' · ')}` : 'Nothing readable there.';
      say(text, r.skipped?.length && !bits.length ? 'err' : 'ok', r.skipped?.length ? r.skipped.map((x) => `Skipped ${x}`) : undefined);
    },
    [say]
  );

  // drag anywhere + paste, exactly like the original
  useEffect(() => {
    let depth = 0;
    const enter = (e) => {
      e.preventDefault();
      if (++depth === 1) setDropHot(true);
    };
    const leave = () => {
      if (--depth <= 0) {
        depth = 0;
        setDropHot(false);
      }
    };
    const over = (e) => e.preventDefault();
    const drop = (e) => {
      e.preventDefault();
      depth = 0;
      setDropHot(false);
      const f = [...(e.dataTransfer?.files || [])];
      if (!f.length) return;
      const into = editorOpenRef.current ? 'edit' : 'main';
      const imgs = f.filter((x) => x.type.startsWith('image/'));
      const rest = f.filter((x) => !x.type.startsWith('image/'));
      if (imgs.length) upload(imgs, 'image', into);
      if (rest.length && into === 'main') upload(rest, 'file');
    };
    const paste = (e) => {
      const f = [...(e.clipboardData?.files || [])];
      if (f.length) {
        e.preventDefault();
        upload(f, 'image', editorOpenRef.current ? 'edit' : 'main');
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [upload]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setLightbox(null);
        setAnimSheet(null);
        setConfirm(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* ── generate ── */
  const bodyOf = (q, v, draft) => ({
    project: project.trim() || 'untitled',
    prompt: approved ? approved.prompt : promptText.trim(),
    negative: approved ? approved.negative : neg.trim(),
    placement_notes: approved ? approved.placement_notes : {},
    brand: brandSel,
    docs: docs.map((d) => d.name),
    refs,
    model: modelId,
    quality: q ?? quality,
    variants: v ?? variants,
    placements: [...picked],
    duration: duration || 8,
    audio: audioOn,
    animate: kind === 'ad' && motionOn,
    animateModel: 'kling-3-pro',
    draft: !!draft,
    textMode: textModeOn,
    copy: copyText.trim()
  });

  const fire = async (body, total) => {
    setGoBusy(true);
    say('Queued…', 'run');
    let r;
    try {
      r = await api.studioCreate(body);
    } catch (err) {
      setGoBusy(false);
      return say(err.message, 'err');
    }
    if (r.error) {
      setGoBusy(false);
      return say(r.error, 'err');
    }
    addSpend(total);
    setJob({
      id: r.jobId,
      state: 'generating',
      items: Object.fromEntries(body.placements.map((p) => [p, { state: 'queued', files: [] }])),
      spec: body
    });
    watchJob(r.jobId);
  };

  const ask = (body, total, rows, sub, warn) => setConfirm({ body, total, rows, sub, warn });

  const editLabel = textModeOn ? 'GPT Image 2 — edit (renders text)' : 'Nano Banana Pro — edit';

  const onGo = () => {
    const body = bodyOf();
    if (!body.prompt) return say('Write a prompt first.', 'err');
    const n = Math.max(1, picked.size) * body.variants;
    ask(
      body,
      price.total,
      [
        ['Model', refs.length && kind !== 'video' ? editLabel : model?.label],
        ...(approved ? [['Prompt', 'Claude’s, approved — free to reuse']] : []),
        ...(refs.length ? [['Reference images', String(refs.length)]] : []),
        ...(docs.length ? [['Source files', String(docs.length)]] : []),
        ...(body.brand ? [['Branding', body.brand]] : []),
        ['Placements', String(picked.size)],
        ...(kind === 'video' || motionOn
          ? [['Length', body.duration + 's' + (body.audio ? ' · audio' : '')]]
          : [['Quality', body.quality]]),
        ['Outputs', body.animate ? `${n} stills + ${n} clips` : String(n)]
      ],
      `${body.project} · ${kind}`
    );
  };

  const draftCost = 0.03 * Math.max(1, picked.size);
  const onDraftAsk = () => {
    const body = bodyOf('low', 1, true);
    if (!body.prompt) return say('Write a prompt first.', 'err');
    body.animate = false;
    ask(
      body,
      draftCost,
      [['Model', 'GPT Image 2'], ['Quality', 'low — draft'], ['Placements', String(picked.size)]],
      'Draft pass · low quality, one each',
      'These are drafts. 3¢ an image to find the composition before you pay 37¢ for it.'
    );
  };
  const fireDraft = () => {
    const body = bodyOf('low', 1, true);
    body.animate = false;
    fire(body, draftCost);
  };

  /* ── the prompt studio ── */
  const onWrite = async () => {
    const rough = promptText.trim();
    if (!rough) return say('Write a rough line first — one is enough.', 'err');
    if (!picked.size) return say('Tick at least one placement so Claude knows what to compose for.', 'err');
    if (textModeOn && !copyText.trim()) return say('Text mode is on — type the exact words you want in the image.', 'err');
    setWriting(true);
    let r;
    try {
      r = await api.studioExpand({
        prompt: rough,
        negative: neg.trim(),
        brand: brandSel,
        docs: docs.map((d) => d.name),
        refs,
        model: modelId,
        placements: [...picked],
        textMode: textModeOn,
        copy: copyText.trim()
      });
    } catch (err) {
      setWriting(false);
      return say(err.message, 'err');
    }
    setWriting(false);
    if (r.error) return say(r.error, 'err');
    setReview({ ...r, rough });
  };

  const approveReview = () => {
    const a = { ...review };
    setApproved(a);
    setReview(null);
    addSpend(a.cost || 0);
    say(
      'Prompt approved and cached. Running the cheap draft pass. The full render will reuse this prompt — Claude is not called again, and you are not charged again.',
      'ok'
    );
    // fire the draft with the freshly approved prompt (state set is async)
    const body = {
      ...bodyOf('low', 1, true),
      prompt: a.prompt,
      negative: a.negative,
      placement_notes: a.placement_notes,
      animate: false
    };
    fire(body, draftCost);
  };

  /* ── retry one frame ── */
  const retryFrame = async (pid) => {
    try {
      const r = await api.studioRetry(job.id, pid);
      if (r.error) return say(r.error, 'err');
      say('Retrying that frame only. The others are untouched.', 'run');
      setGoBusy(true);
      watchJob(job.id);
    } catch (err) {
      say(err.message, 'err');
    }
  };

  /* ── export ── */
  const loadImg = (src) =>
    new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });

  const onExport = async () => {
    if (!job) return say('Nothing to export — generate first.', 'err');
    const list = (cfg?.placements || []).filter(
      (p) => picked.has(p.id) && (job.items?.[p.id]?.files || []).some((f) => !f.video)
    );
    if (!list.length) return say('Nothing rendered yet.', 'err');
    say('Exporting…', 'run');
    const name = project.trim() || 'untitled';
    let n = 0;
    for (const p of list) {
      const src = job.items[p.id].files.find((f) => !f.video)?.url;
      try {
        const im = await loadImg(src);
        const c = document.createElement('canvas');
        c.width = p.w;
        c.height = p.h;
        const x = c.getContext('2d');
        const s = Math.max(p.w / im.width, p.h / im.height);
        x.drawImage(im, (p.w - im.width * s) / 2, (p.h - im.height * s) / 2, im.width * s, im.height * s);
        const a = document.createElement('a');
        a.href = c.toDataURL('image/png');
        a.download = `${name}-${p.id}-${p.w}x${p.h}.png`;
        a.click();
        n++;
        await new Promise((r) => setTimeout(r, 220));
      } catch {
        window.open(src, '_blank', 'noopener');
      }
    }
    say(
      job?.spec?.draft
        ? `${n} exported — but these are the low-quality drafts. Render at full quality first if these are going live.`
        : `${n} exported at exact placement dimensions.`,
      job?.spec?.draft ? 'err' : 'ok'
    );
  };

  /* ── library ── */
  const openLibrary = async () => {
    setView('lib');
    setLibrary(null);
    try {
      const r = await api.studioLibrary();
      setLibrary(r.items || []);
    } catch (err) {
      setLibrary([]);
      say(err.message, 'err');
    }
  };

  const download = async (url) => {
    try {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = url.split('/').pop()?.split('?')[0] || 'creative.png';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  };

  /* ── editor ── */
  const chainPollRef = useRef(0);
  const openEditor = (src, chain = null) => {
    chainPollRef.current++;
    setLightbox(null);
    setEditor({ chain, src, refs: [], text: '', reason: null, n: 1, busy: false });
  };
  const closeEditor = () => {
    chainPollRef.current++;
    setEditor(null);
  };

  const watchChain = (chainId, n) => {
    const token = ++chainPollRef.current;
    const tick = async () => {
      if (token !== chainPollRef.current) return;
      let chain = null;
      try {
        const r = await api.studioChain(chainId);
        chain = r.chain || null;
        if (r.error && !chain) {
          setEditor((ed) => (ed ? { ...ed, busy: false, reason: { tone: 'warn', text: r.error } } : ed));
          return;
        }
      } catch {
        // transient - keep polling
      }
      if (token !== chainPollRef.current) return;
      if (chain && !chain.pending) {
        if (chain.error) {
          setEditor((ed) => (ed ? { ...ed, chain, busy: false, reason: { tone: 'warn', text: chain.error } } : ed));
          return;
        }
        const last = chain.steps[chain.steps.length - 1];
        addSpend(0.15 * n);
        loadBalance();
        setEditor((ed) => (ed ? { ...ed, chain, src: last.results[0], busy: false } : ed));
        return;
      }
      setTimeout(tick, 1500);
    };
    tick();
  };

  const runEdit = async () => {
    if (!editor) return;
    const instruction = editor.text.trim();
    if (!instruction) return;
    setEditor((ed) => ({ ...ed, busy: true }));
    let r;
    try {
      r = await api.studioEdit({
        src: editor.src,
        refs: editor.refs,
        instruction,
        chainId: editor.chain?.id,
        n: editor.n
      });
    } catch (err) {
      return setEditor((ed) => (ed ? { ...ed, busy: false, reason: { tone: 'warn', text: err.message } } : ed));
    }
    if (r.error) return setEditor((ed) => (ed ? { ...ed, busy: false, reason: { tone: 'warn', text: r.error } } : ed));
    setEditor((ed) => (ed ? { ...ed, chain: r.chain } : ed));
    watchChain(r.chain.id, editor.n);
  };

  const writeEditInstruction = async () => {
    if (!editor) return;
    const rough = editor.text.trim();
    if (!rough) return;
    if (!cfg?.claude) {
      return setEditor((ed) => ({
        ...ed,
        reason: { tone: 'warn', text: 'Prompt writer is off — add ANTHROPIC_API_KEY in Netlify. Your instruction will be used as written.' }
      }));
    }
    setEditor((ed) => ({ ...ed, busy: 'write' }));
    let r;
    try {
      r = await api.studioExpandEdit({ src: editor.src, refs: editor.refs, instruction: rough, textMode: textModeOn });
    } catch (err) {
      return setEditor((ed) => (ed ? { ...ed, busy: false, reason: { tone: 'warn', text: err.message } } : ed));
    }
    if (r.error) return setEditor((ed) => (ed ? { ...ed, busy: false, reason: { tone: 'warn', text: r.error } } : ed));
    addSpend(r.cost || 0);
    setEditor((ed) =>
      ed
        ? {
            ...ed,
            busy: false,
            text: r.instruction,
            reason: {
              tone: 'note',
              text: `${r.reasoning} — Note what it pinned down. Nano Banana redraws anything you don't explicitly protect.`
            }
          }
        : ed
    );
  };

  /* ── animate ── */
  const motionPollRef = useRef(0);
  const runAnimate = async () => {
    const sheet = animSheet;
    setAnimSheet(null);
    const cost = P[sheet.model]?.(null, sheet.duration, false) || 0;
    say('Animating… a few minutes. The clip lands in the Library.', 'run');
    let r;
    try {
      r = await api.studioAnimate({ src: sheet.src, prompt: sheet.text, model: sheet.model, duration: sheet.duration });
    } catch (err) {
      return say(err.message, 'err');
    }
    if (r.error) return say(r.error, 'err');
    addSpend(cost);
    const token = ++motionPollRef.current;
    const tick = async () => {
      if (token !== motionPollRef.current) return;
      try {
        const m = (await api.studioMotion(r.motionId)).motion;
        if (m?.state === 'done') {
          loadBalance();
          return say('Clip ready. It is in the Library.', 'ok');
        }
        if (m?.state === 'error') return say(m.error || 'The animate run failed.', 'err');
      } catch {
        // transient - keep polling
      }
      setTimeout(tick, 2500);
    };
    tick();
  };

  /* ═══ render ═══ */
  if (redirecting) return null;

  const upsellVisible = job?.spec?.draft && ['done', 'partial'].includes(job.state);
  const upsellQuality = quality === 'low' ? 'high' : quality;
  const upsellN = Math.max(1, picked.size) * (variants || 1);
  const upsellCost = (P[unit()]?.(upsellQuality) || 0.1) * upsellN;

  const placements = cfg?.placements || [];
  const durations = model?.durations || cfg?.models.animate[0]?.durations || [5, 8];
  const showVidOpts = kind === 'video' || (kind === 'ad' && motionOn);

  return (
    <div className="studio-page">
      <TopNav email={status?.email} />

      <main className="studio-main">
        <div className="studio-head">
          <h1>Leadly Studio</h1>
          <div className="studio-view-tabs" role="tablist" aria-label="Studio view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'make'}
              className={view === 'make' ? 'on' : ''}
              onClick={() => {
                setView('make');
                if (job) watchJob(job.id);
              }}
            >
              Make
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'lib'}
              className={view === 'lib' ? 'on' : ''}
              onClick={openLibrary}
            >
              Library
            </button>
          </div>
          <div className="studio-bal" title={balanceHint}>
            <div>
              <span className="studio-bal-label">fal credits</span>
              <b className={balance == null ? 'na' : balance < 2 ? 'out' : balance < 10 ? 'low' : ''}>
                {balance === undefined ? '…' : balance === null ? 'unavailable' : money(balance)}
              </b>
            </div>
            <div>
              <span className="studio-bal-label">spent here</span>
              <b className="spend">{money(spend)}</b>
            </div>
            <button type="button" onClick={loadBalance} title="Refresh balance" aria-label="Refresh balance">
              ↻
            </button>
          </div>
        </div>

        {statusError && <ErrorState message={statusError} onRetry={() => window.location.reload()} />}
        {cfgError && <ErrorState message={cfgError} onRetry={() => window.location.reload()} />}

        {cfg?.mock && (
          <div className="studio-msg ok">
            Dry run (STUDIO_MOCK=1) — nothing is sent to fal or Anthropic, nothing is charged.
          </div>
        )}
        {cfg && !cfg.falConfigured && (
          <div className="studio-msg err">
            FAL_KEY isn't configured, so nothing can render yet. Add it in Netlify's environment variables (fal.ai →
            API Keys).
          </div>
        )}

        {!cfg && !cfgError && (
          <div className="card studio-loading" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton studio-skeleton-row" />
            ))}
          </div>
        )}

        {cfg && view === 'make' && (
          <div className="studio-layout">
            <aside className="studio-side">
              {/* 1 · what */}
              <section className="studio-step">
                <h4>
                  <i>1</i> What are you making
                </h4>
                <div className="studio-kinds">
                  {[
                    ['image', 'Image', 'one size'],
                    ['video', 'Video', '16:9 · 9:16'],
                    ['ad', 'Ads', 'every placement']
                  ].map(([k, label, sub]) => (
                    <button
                      key={k}
                      type="button"
                      className={`studio-kind${kind === k ? ' on' : ''}`}
                      onClick={() => setKindAndDefaults(k)}
                    >
                      <b>{label}</b>
                      <span>{sub}</span>
                    </button>
                  ))}
                </div>
                {kind === 'ad' && (
                  <Toggle
                    on={motionOn}
                    onClick={() => setMotionOn((v) => !v)}
                    title="Add motion"
                    sub="Animate each still. The only way to get 1:1 and 4:5 video ads — Veo can't make them."
                  />
                )}
              </section>

              {/* 2 · reference images */}
              <section className="studio-step">
                <h4>
                  <i>2</i> Upload
                </h4>
                <button type="button" className="studio-drop" onClick={() => fileRef.current?.click()}>
                  <b>Drop images</b>
                  <span>click · paste (⌘V) · or drag anywhere</span>
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    upload(e.target.files, 'image');
                    e.target.value = '';
                  }}
                />
                {refs.length > 0 && (
                  <>
                    <div className="studio-refs">
                      {refs.map((u, i) => (
                        <span key={`${u.slice(0, 40)}-${i}`} className="studio-ref">
                          <img src={u} alt={`Reference ${i + 1}`} />
                          <button type="button" onClick={() => setRefs((cur) => cur.filter((_, k) => k !== i))} aria-label="Remove reference">
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="studio-note">
                      <b>Reference mode.</b> Your prompt becomes an <b>instruction</b> — Studio edits and blends instead
                      of generating from nothing, across every placement.
                    </div>
                  </>
                )}
              </section>

              {/* 3 · files */}
              <section className="studio-step">
                <h4>
                  <i>3</i> Files
                </h4>
                <button type="button" className="studio-drop" onClick={() => fileDocRef.current?.click()}>
                  <b>Drop a brief or a spec</b>
                  <span>.md · .txt · .csv · .json · .pdf</span>
                </button>
                <input
                  ref={fileDocRef}
                  type="file"
                  accept=".md,.markdown,.txt,.csv,.json,.pdf,.html"
                  multiple
                  hidden
                  onChange={(e) => {
                    upload(e.target.files, 'file');
                    e.target.value = '';
                  }}
                />
                {docs.length > 0 && (
                  <>
                    <div className="studio-docs">
                      {docs.map((d, i) => (
                        <span key={d.name + i} className="studio-doc">
                          <span className="studio-doc-name">{d.from || d.name}</span>
                          <span className="studio-doc-size">{(d.chars / 1000).toFixed(1)}k</span>
                          <button type="button" onClick={() => setDocs((cur) => cur.filter((_, k) => k !== i))} aria-label="Remove file">
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="studio-note">
                      <b>
                        {docs.length} file{docs.length > 1 ? 's' : ''} feed every prompt.
                      </b>{' '}
                      Claude reads them and takes the offer, the audience and the tone from them.
                    </div>
                  </>
                )}
              </section>

              {/* 4 · name */}
              <section className="studio-step">
                <h4>
                  <i>4</i> File name
                </h4>
                <input
                  className="studio-input"
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value);
                    setApproved(null);
                  }}
                  onBlur={() => resume(project)}
                />
                <p className="studio-sub">
                  Exports name themselves:{' '}
                  <b>
                    {(project.trim() || 'untitled') +
                      '-' +
                      (placements.find((x) => picked.has(x.id))?.id || 'square') +
                      '-1024x1024.png'}
                  </b>
                </p>
              </section>

              {/* 5 · prompt */}
              <section className="studio-step">
                <h4>
                  <i>5</i> Prompt
                </h4>
                <textarea
                  className="studio-input studio-prompt"
                  value={promptText}
                  onChange={(e) => {
                    setPromptText(e.target.value);
                    if (approved) {
                      setApproved(null);
                      say('Prompt changed — the approved version is cleared. Write it again when ready.', 'run');
                    }
                  }}
                  placeholder={
                    'A rough line is enough. Claude turns it into a production prompt and shows you before anything is generated.\n\ne.g. retirement ad, guy on an HDB corridor, golden hour'
                  }
                />
                <Toggle
                  on={textModeOn}
                  onClick={toggleTextMode}
                  title="Put text IN the image"
                  sub="For mirroring an ad that has a headline baked in. Off = clean image, copy goes on later."
                />
                {textModeOn && (
                  <div>
                    <label className="studio-label" htmlFor="studio-copy">
                      The exact words
                    </label>
                    <textarea
                      id="studio-copy"
                      className="studio-input studio-copy"
                      value={copyText}
                      onChange={(e) => setCopyText(e.target.value)}
                      placeholder={'How much do you really need to retire?\n\nCompare plans now'}
                    />
                    <p className="studio-sub">
                      Used <b>verbatim</b>. The model renders these words and invents none of its own.{' '}
                      <b>Check the spelling of the render</b> — models still fumble text occasionally.
                    </p>
                  </div>
                )}
                <label className="studio-label" htmlFor="studio-neg">
                  Keep out
                </label>
                <input id="studio-neg" className="studio-input" value={neg} onChange={(e) => setNeg(e.target.value)} />
                <p className="studio-sub">
                  The blocklist — habits the model has that you don't want. Not mentioning something does <b>not</b> stop
                  it drawing it.
                </p>
              </section>

              {/* 6 · model */}
              <section className="studio-step">
                <h4>
                  <i>6</i> Model
                </h4>
                <select className="studio-input" value={model?.id || ''} onChange={(e) => changeModel(e.target.value)}>
                  {pool.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <p className="studio-sub">{model?.blurb}</p>
              </section>

              {/* 7 · branding */}
              <section className="studio-step">
                <h4>
                  <i>7</i> Branding
                </h4>
                <select className="studio-input" value={brandSel} onChange={(e) => setBrandSel(e.target.value)}>
                  <option value="">— none —</option>
                  {(cfg.brands || []).map((b) => (
                    <option key={b} value={b}>
                      {b.replace(/\.md$/, '')}
                    </option>
                  ))}
                </select>
                <p className="studio-sub">
                  A markdown file of your permanent rules. Drop the <b>.md</b> into the Files box and it lands here. It
                  outranks Claude's taste.
                </p>
              </section>

              {/* 8 · placements */}
              <section className="studio-step">
                <h4>
                  <i>8</i> Placements
                </h4>
                <div className="studio-plc">
                  {placements.map((p) => {
                    const [a, b] = p.ratio.split(':').map(Number);
                    const w = a >= b ? 20 : Math.round((20 * a) / b);
                    const h = b >= a ? 20 : Math.round((20 * b) / a);
                    const on = picked.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`studio-p${on ? ' on' : ''}`}
                        onClick={() =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                            return next;
                          })
                        }
                      >
                        <span className="studio-p-shape" style={{ width: w, height: h }} aria-hidden="true" />
                        <span className="studio-p-copy">
                          <b>{p.label}</b>
                          <span>{p.where}</span>
                        </span>
                        <span className="studio-p-ratio">{p.ratio}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="studio-chips">
                  <button type="button" onClick={() => setPicked(new Set(placements.map((p) => p.id)))}>
                    All
                  </button>
                  <button type="button" onClick={() => setPicked(new Set(['square', 'portrait', 'story']))}>
                    Meta
                  </button>
                  <button type="button" onClick={() => setPicked(new Set())}>
                    None
                  </button>
                </div>
              </section>

              {/* 9 · variants & quality */}
              <section className="studio-step">
                <h4>
                  <i>9</i> Variants &amp; quality
                </h4>
                <div className="studio-row">
                  <div>
                    <label className="studio-label" htmlFor="studio-variants">
                      Variants
                    </label>
                    <select
                      id="studio-variants"
                      className="studio-input"
                      value={variants}
                      onChange={(e) => setVariants(+e.target.value)}
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="studio-label" htmlFor="studio-quality">
                      Quality
                    </label>
                    <select
                      id="studio-quality"
                      className="studio-input"
                      value={quality}
                      onChange={(e) => setQuality(e.target.value)}
                    >
                      {(model?.qualities || ['medium']).map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {showVidOpts && (
                  <div>
                    <label className="studio-label" htmlFor="studio-duration">
                      Length
                    </label>
                    <select
                      id="studio-duration"
                      className="studio-input"
                      value={duration}
                      onChange={(e) => setDuration(+e.target.value)}
                    >
                      {durations.map((d) => (
                        <option key={d} value={d}>
                          {d} seconds
                        </option>
                      ))}
                    </select>
                    <Toggle on={audioOn} onClick={() => setAudioOn((v) => !v)} title="Native audio" sub="Doubles the cost." />
                  </div>
                )}
                <Toggle
                  on={safeOn}
                  onClick={() => setSafeOn((v) => !v)}
                  title="Show unsafe zones"
                  sub="Where Stories and Reels cover your ad with their own UI."
                />
              </section>

              <div className="studio-actions">
                {upsellVisible && (
                  <div className="studio-note studio-upsell">
                    <b>These are drafts.</b> Low quality, 3¢ each — they exist to show you the composition. When one
                    looks right, render it properly.
                    <button
                      type="button"
                      className="studio-btn exp"
                      onClick={() => {
                        const body = bodyOf(upsellQuality);
                        body.draft = false;
                        ask(
                          body,
                          upsellCost,
                          [
                            ['Model', refs.length && kind !== 'video' ? editLabel : model?.label],
                            ...(approved ? [['Prompt', 'the one you approved — free to reuse']] : []),
                            ['Quality', upsellQuality],
                            ['Placements', String(picked.size)],
                            ['Outputs', String(upsellN)]
                          ],
                          `${body.project} · the real render`
                        );
                      }}
                    >
                      Render at {upsellQuality} quality — {money(upsellCost)}
                    </button>
                  </div>
                )}
                {!cfg.claude && (
                  <div className="studio-note warn">
                    <b>Prompt writer is off.</b> Add <code>ANTHROPIC_API_KEY</code> in Netlify to switch it on.
                    Everything else works — your prompt is used exactly as written.
                  </div>
                )}
                <div className="studio-cost">
                  <span>{price.what || '—'}</span>
                  <b>{money(price.total)}</b>
                </div>
                <button type="button" className="studio-btn ai" onClick={onWrite} disabled={!cfg.claude || writing}>
                  {!cfg.claude ? 'Prompt writer off' : writing ? 'Claude is writing…' : 'Write the prompt'}
                </button>
                <button type="button" className="studio-btn pri" onClick={onGo} disabled={!picked.size || goBusy}>
                  {refs.length ? 'Edit with references' : 'Generate'}
                </button>
                {kind !== 'video' && (
                  <button type="button" className="studio-btn gh" onClick={onDraftAsk}>
                    Cheap draft pass — {money(draftCost)}
                  </button>
                )}
                {kind !== 'video' && (
                  <button type="button" className="studio-btn exp" onClick={onExport}>
                    Export all placements — free
                  </button>
                )}
              </div>
            </aside>

            <section className="studio-stage">
              {msg && (
                <div className={`studio-msg ${msg.tone}`}>
                  {msg.text}
                  {msg.list && (
                    <ul>
                      {msg.list.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {kind === 'video' ? (
                <div className="studio-empty">
                  <b>Video has no layout step.</b>
                  Veo renders 16:9 or 9:16 straight from the prompt. Clips land in the Library.
                </div>
              ) : !picked.size ? (
                <div className="studio-empty">
                  <b>No placements ticked.</b>
                  Pick where this has to live.
                </div>
              ) : (
                <div className="studio-board">
                  {placements
                    .filter((p) => picked.has(p.id))
                    .map((p) => {
                      const [a, c] = p.ratio.split(':').map(Number);
                      const W = 250;
                      const H = Math.round((W * c) / a);
                      const u = (cfg.unsafe || {})[p.id] || { top: 0, bottom: 0, why: '' };
                      const item = job?.items?.[p.id];
                      const files = item?.files || [];
                      const imgs = files.filter((f) => !f.video);
                      const vids = files.filter((f) => f.video);
                      const shown = imgs[0]?.url || null;
                      const note = job?.spec?.placement_notes?.[p.id];
                      const st = item?.state || 'idle';
                      return (
                        <div className="studio-frame" key={p.id}>
                          <div className="studio-fh">
                            <b>{p.label}</b>
                            <span>
                              {p.ratio} · {p.w}×{p.h}
                            </span>
                          </div>
                          <div
                            className="studio-canvas"
                            style={{ width: W, height: H }}
                            onClick={() => shown && setLightbox({ url: shown, video: false })}
                            role={shown ? 'button' : undefined}
                          >
                            <div
                              className={`studio-art${shown ? '' : ' none'}`}
                              style={shown ? { backgroundImage: `url("${shown}")` } : undefined}
                            />
                            {safeOn && u.top > 0 && (
                              <div className="studio-unsafe t" style={{ height: `${u.top}%` }}>
                                <span>{u.why}</span>
                              </div>
                            )}
                            {safeOn && u.bottom > 0 && (
                              <div className="studio-unsafe b" style={{ height: `${u.bottom}%` }}>
                                <span>{u.why}</span>
                              </div>
                            )}
                            {(st === 'generating' || st === 'queued') && (
                              <div className="studio-veil">
                                <i aria-hidden="true" />
                                <p>{st}…</p>
                              </div>
                            )}
                            {st === 'error' && (
                              <div className="studio-veil">
                                <p className="studio-veil-err">{String(item.error || '').slice(0, 150)}</p>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    retryFrame(p.id);
                                  }}
                                >
                                  Retry this frame
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="studio-fh">
                            <span className={`studio-st ${st}`}>{st}</span>
                            {shown ? (
                              <button type="button" className="studio-edit-btn" onClick={() => openEditor(shown)}>
                                Edit
                              </button>
                            ) : (
                              <span>{u.top || u.bottom ? '⚠ keep the subject off the stripes' : ''}</span>
                            )}
                          </div>
                          {(imgs.length > 1 || vids.length > 0) && (
                            <div className="studio-vlist">
                              {imgs.map((f, i) => (
                                <img
                                  key={i}
                                  src={f.url}
                                  className={i === 0 ? 'on' : ''}
                                  alt={`Variant ${i + 1}`}
                                  onClick={() => setLightbox({ url: f.url, video: false })}
                                />
                              ))}
                              {vids.map((f, i) => (
                                <video
                                  key={i}
                                  src={f.url}
                                  muted
                                  loop
                                  autoPlay
                                  playsInline
                                  onClick={() => setLightbox({ url: f.url, video: true })}
                                />
                              ))}
                            </div>
                          )}
                          {note && <div className="studio-pnote">{note}</div>}
                        </div>
                      );
                    })}
                </div>
              )}
            </section>
          </div>
        )}

        {cfg && view === 'lib' && (
          <section className="studio-libwrap">
            {library === null && (
              <div className="card studio-loading" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton studio-skeleton-row" />
                ))}
              </div>
            )}
            {library && library.length === 0 && (
              <div className="studio-empty">
                <b>Nothing here yet.</b>
                Everything you generate or upload lands in this library.
              </div>
            )}
            {library && library.length > 0 && (
              <div className="studio-grid">
                {library.map((it, i) => (
                  <button
                    key={i}
                    type="button"
                    className="studio-card"
                    onClick={() => setLightbox({ url: it.url, video: it.video })}
                  >
                    {it.video ? (
                      <video src={it.url} muted loop autoPlay playsInline />
                    ) : (
                      <img src={it.url} loading="lazy" alt={it.name} />
                    )}
                    <span className="studio-cap">
                      <b>{it.project}</b>
                      <span>{it.name}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* confirm sheet */}
      {confirm && (
        <div className="studio-overlay" onClick={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="studio-sheet" role="dialog" aria-label="Before you spend">
            <h3>Before you spend</h3>
            <p className="studio-sheet-sub">{confirm.sub}</p>
            {confirm.warn && <div className="studio-warnbar">{confirm.warn}</div>}
            {balance != null && balance - confirm.total < 0 && (
              <div className="studio-warnbar">
                <b>Not enough credits.</b> This costs {money(confirm.total)}; you have {money(balance)}.
              </div>
            )}
            <div className="studio-lines">
              {confirm.rows.map(([k, v], i) => (
                <div className="studio-ln" key={i}>
                  <span>{k}</span>
                  <b>{v}</b>
                </div>
              ))}
              <div className="studio-ln total">
                <span>Total</span>
                <b>{money(confirm.total)}</b>
              </div>
              {balance != null && (
                <div className={`studio-ln after${balance - confirm.total < 0 ? ' bad' : ''}`}>
                  <span>Credits left after this</span>
                  <b>{money(balance - confirm.total)}</b>
                </div>
              )}
            </div>
            <div className="studio-sheet-acts">
              <button type="button" className="no" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="yes"
                disabled={balance != null && balance - confirm.total < 0}
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  fire(c.body, c.total);
                }}
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* review screen */}
      {review && (
        <div className="studio-review" role="dialog" aria-label="Claude wrote your prompt">
          <div className="studio-review-head">
            <h2>Claude wrote your prompt</h2>
            <div className="studio-cost slim">
              <span>expansion cost</span>
              <b>${(review.cost || 0).toFixed(4)}</b>
            </div>
          </div>
          <div className="studio-review-body">
            <div className="studio-pane">
              <h5>What you wrote</h5>
              <p className="studio-mine">{review.rough}</p>
            </div>
            <div className="studio-pane">
              <h5>Why — sanity-check it</h5>
              <p className="studio-reason">{review.reasoning || '(none given)'}</p>
              <h5 className="spaced">Keep out (expanded)</h5>
              <textarea
                className="studio-input"
                value={review.negative}
                onChange={(e) => setReview((r) => ({ ...r, negative: e.target.value }))}
              />
            </div>
            <div className="studio-pane full">
              <h5>The production prompt — edit anything</h5>
              <textarea
                className="studio-input studio-review-prompt"
                value={review.prompt}
                onChange={(e) => setReview((r) => ({ ...r, prompt: e.target.value }))}
              />
            </div>
            <div className="studio-pane full">
              <h5>How to compose for each placement</h5>
              <div className="studio-pnotes">
                {[...picked].map((id) => {
                  const p = placements.find((x) => x.id === id);
                  if (!p) return null;
                  const u = (cfg.unsafe || {})[id] || { top: 0, bottom: 0 };
                  const [a, c] = p.ratio.split(':').map(Number);
                  const H = Math.min(Math.round((190 * c) / a), 240);
                  return (
                    <div className="studio-pn" key={id}>
                      <div className="studio-pn-head">
                        {p.label} · {p.ratio}
                      </div>
                      <div className="studio-pn-shape" style={{ height: H }}>
                        {u.top > 0 && <div className="u" style={{ top: 0, height: `${u.top}%` }} />}
                        {u.bottom > 0 && <div className="u" style={{ bottom: 0, height: `${u.bottom}%` }} />}
                      </div>
                      <div className="studio-pn-text">{review.placement_notes?.[id] || '— no note —'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="studio-review-foot">
            <button type="button" className="no" onClick={() => setReview(null)}>
              Discard
            </button>
            <button type="button" className="yes" onClick={approveReview}>
              Approve → cheap draft pass
            </button>
          </div>
        </div>
      )}

      {/* editor workspace */}
      {editor && (
        <div className="studio-editor" role="dialog" aria-label="Editor">
          <div className="studio-editor-head">
            <h2>Editor</h2>
            <span className="studio-editor-chainlabel">
              {editor.chain
                ? `${editor.chain.steps.length} step${editor.chain.steps.length > 1 ? 's' : ''} · nothing overwritten`
                : 'new chain'}
            </span>
            <button type="button" onClick={closeEditor}>
              Close
            </button>
          </div>
          <div className="studio-editor-body">
            <div className="studio-editor-left">
              <div className="studio-editor-stage">
                {(() => {
                  const origin = editor.chain?.origin || editor.src;
                  if (editor.src === origin) return <BeforeAfter before={origin} after={null} />;
                  const step = (editor.chain?.steps || []).find((s) => s.results.includes(editor.src));
                  return <BeforeAfter before={step ? step.src : origin} after={editor.src} />;
                })()}
                {editor.busy === true && (
                  <div className="studio-veil">
                    <i aria-hidden="true" />
                    <p>Editing…</p>
                  </div>
                )}
              </div>
              <div className="studio-hist">
                {(() => {
                  const origin = editor.chain?.origin || editor.src;
                  const cells = [
                    <button
                      key="origin"
                      type="button"
                      className={`studio-hs${editor.src === origin ? ' on' : ''}`}
                      onClick={() => setEditor((ed) => ({ ...ed, src: origin }))}
                    >
                      <img src={origin} alt="Original" />
                      <span>original</span>
                    </button>
                  ];
                  (editor.chain?.steps || []).forEach((s, i) => {
                    s.results.forEach((r, k) => {
                      cells.push(
                        <span key={`arr-${i}-${k}`} className="studio-arr" aria-hidden="true">
                          →
                        </span>,
                        <button
                          key={`hs-${i}-${k}`}
                          type="button"
                          className={`studio-hs${editor.src === r ? ' on' : ''}`}
                          title={s.instruction.slice(0, 120)}
                          onClick={() => setEditor((ed) => ({ ...ed, src: r }))}
                        >
                          <img src={r} alt={`Step ${i + 1}`} />
                          <span>
                            step {i + 1}
                            {s.results.length > 1 ? '.' + (k + 1) : ''}
                          </span>
                        </button>
                      );
                    });
                  });
                  return cells;
                })()}
              </div>
            </div>
            <div className="studio-editor-right">
              <label className="studio-label" htmlFor="studio-edtext">
                What should change
              </label>
              <textarea
                id="studio-edtext"
                className="studio-input"
                value={editor.text}
                onChange={(e) => setEditor((ed) => ({ ...ed, text: e.target.value }))}
                placeholder="A rough line. Claude turns it into a precise instruction that pins down what to leave alone — which is the part that stops the model wrecking the image."
              />
              <button
                type="button"
                className="studio-btn ai"
                onClick={writeEditInstruction}
                disabled={editor.busy === 'write'}
              >
                {editor.busy === 'write' ? 'Claude is writing…' : 'Write the instruction'}
              </button>
              {editor.reason && (
                <div className={`studio-note${editor.reason.tone === 'warn' ? ' warn' : ''}`}>{editor.reason.text}</div>
              )}

              <label className="studio-label spaced" htmlFor="studio-edfile">
                Extra reference images
              </label>
              <button type="button" className="studio-drop slim" onClick={() => fileEdRef.current?.click()}>
                <b>Drop or click</b>
                <span>blend other images into this edit</span>
              </button>
              <input
                id="studio-edfile"
                ref={fileEdRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  upload(e.target.files, 'image', 'edit');
                  e.target.value = '';
                }}
              />
              {editor.refs.length > 0 && (
                <div className="studio-refs">
                  {editor.refs.map((u, i) => (
                    <span key={i} className="studio-ref">
                      <img src={u} alt={`Edit reference ${i + 1}`} />
                      <button
                        type="button"
                        onClick={() => setEditor((ed) => ({ ...ed, refs: ed.refs.filter((_, k) => k !== i) }))}
                        aria-label="Remove reference"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <label className="studio-label spaced" htmlFor="studio-edn">
                Variants
              </label>
              <select
                id="studio-edn"
                className="studio-input"
                value={editor.n}
                onChange={(e) => setEditor((ed) => ({ ...ed, n: +e.target.value }))}
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>

              <div className="studio-cost spaced">
                <span>
                  {editor.n} edit{editor.n > 1 ? 's' : ''} · Nano Banana Pro
                </span>
                <b>{money(0.15 * editor.n)}</b>
              </div>
              <button type="button" className="studio-btn pri" onClick={runEdit} disabled={editor.busy === true}>
                {editor.busy === true ? 'Editing…' : 'Run the edit'}
              </button>
              <p className="studio-sub">
                The source is never destroyed. Every step is kept — click any of them to branch from it.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* lightbox */}
      {lightbox && (
        <div className="studio-box" onClick={(e) => e.target === e.currentTarget && setLightbox(null)}>
          {lightbox.video ? <video src={lightbox.url} controls autoPlay loop /> : <img src={lightbox.url} alt="Preview" />}
          <div className="studio-box-acts">
            {!lightbox.video && (
              <>
                <button type="button" className="pri" onClick={() => openEditor(lightbox.url)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="pri"
                  onClick={() => {
                    setAnimSheet({ src: lightbox.url, text: '', model: 'kling-3-pro', duration: 5 });
                    setLightbox(null);
                  }}
                >
                  Animate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRefs((cur) => (cur.includes(lightbox.url) ? cur : [...cur, lightbox.url]));
                    setLightbox(null);
                    setView('make');
                  }}
                >
                  Use as reference
                </button>
              </>
            )}
            <button type="button" onClick={() => download(lightbox.url)}>
              Download
            </button>
            <button type="button" onClick={() => setLightbox(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* animate sheet */}
      {animSheet && (
        <div className="studio-overlay" onClick={(e) => e.target === e.currentTarget && setAnimSheet(null)}>
          <div className="studio-sheet" role="dialog" aria-label="Animate this image">
            <h3>Animate this image</h3>
            <p className="studio-sheet-sub">
              Keep the motion <b>small</b>. The aspect ratio comes from the image — so this works in ratios Veo cannot
              do.
            </p>
            <textarea
              className="studio-input"
              value={animSheet.text}
              onChange={(e) => setAnimSheet((s) => ({ ...s, text: e.target.value }))}
              placeholder="e.g. Slow push in. The light shifts gently. Nothing else moves."
            />
            <div className="studio-row spaced">
              <div>
                <label className="studio-label" htmlFor="studio-am">
                  Model
                </label>
                <select
                  id="studio-am"
                  className="studio-input"
                  value={animSheet.model}
                  onChange={(e) => setAnimSheet((s) => ({ ...s, model: e.target.value }))}
                >
                  {cfg.models.animate.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="studio-label" htmlFor="studio-ad">
                  Length
                </label>
                <select
                  id="studio-ad"
                  className="studio-input"
                  value={animSheet.duration}
                  onChange={(e) => setAnimSheet((s) => ({ ...s, duration: +e.target.value }))}
                >
                  <option value={5}>5 seconds</option>
                  <option value={10}>10 seconds</option>
                </select>
              </div>
            </div>
            <div className="studio-cost spaced">
              <span>
                {animSheet.duration}s · {cfg.models.animate.find((m) => m.id === animSheet.model)?.label}
              </span>
              <b>{money(P[animSheet.model]?.(null, animSheet.duration, false) || 0)}</b>
            </div>
            <div className="studio-sheet-acts">
              <button type="button" className="no" onClick={() => setAnimSheet(null)}>
                Cancel
              </button>
              <button type="button" className="yes" onClick={runAnimate}>
                Animate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* drop curtain */}
      {dropHot && (
        <div className="studio-curtain" aria-hidden="true">
          <div>Drop images, or a brief</div>
        </div>
      )}
    </div>
  );
}
