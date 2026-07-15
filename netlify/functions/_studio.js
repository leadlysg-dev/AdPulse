// Leadly Studio - the creative-generation engine, ported from the standalone
// Creative Studio server to Netlify Functions.
//
// Two things had to change shape in the port, and both are structural:
//
// 1. NO DISK. The original wrote every image, job file, and chain to a local
//    out/ folder ("the disk is the only source of truth"). Functions have no
//    durable disk, so the source of truth is now the store (_store.js):
//    jobs/chains/motion runs are JSON records, and the media itself stays
//    where fal already hosts it - generated files are fal CDN URLs, and
//    reference uploads go to fal storage. Nothing binary passes through us.
//
// 2. NO WAITING. The original blocked on fal.subscribe() for minutes per
//    frame. A function times out in seconds, so every generation goes
//    through fal's queue API instead: submit returns immediately, and the
//    browser's existing poll loop drives advanceJob(), which checks pending
//    requests and submits the next step each tick. Kill the tab mid-job and
//    it still recovers - the state machine lives in the store, not the page.
//
// FAL_KEY and ANTHROPIC_API_KEY never reach the browser, same as before.
// Set STUDIO_MOCK=1 to drive the whole tab - jobs, retries, edit chains,
// the prompt writer - without calling fal or Anthropic.
const fetch = require('node-fetch');

/* ── registry: everything the Studio knows how to do ──────────
   Adding a model is one entry in MODELS. The UI builds itself from
   studio-init, so nothing else needs touching. */

// Every dimension is a multiple of 16, which gpt-image-2 requires. The
// "true" ad sizes (1080x1080 etc.) are not - these are the nearest legal
// size, and they scale down to the real one cleanly at export.
const PLACEMENTS = [
  { id: 'square', label: 'Feed — square', ratio: '1:1', w: 1024, h: 1024, where: 'Instagram & Facebook feed' },
  { id: 'portrait', label: 'Feed — portrait', ratio: '4:5', w: 1024, h: 1280, where: 'Meta feed. The one that wins.' },
  { id: 'story', label: 'Story / Reel', ratio: '9:16', w: 1024, h: 1808, where: 'IG Stories, Reels, TikTok, Shorts' },
  { id: 'landscape', label: 'Landscape', ratio: '16:9', w: 1280, h: 720, where: 'YouTube, in-stream, display' },
  { id: 'wide', label: 'Wide banner', ratio: '1.9:1', w: 1216, h: 640, where: 'Google Display, LinkedIn, link previews' },
  { id: 'tall', label: 'Tall pin', ratio: '2:3', w: 1024, h: 1536, where: 'Pinterest' },
  { id: 'hero', label: 'Website hero', ratio: '16:10', w: 1920, h: 1200, where: 'Landing page backgrounds' }
];

// Veo can only do 16:9 and 9:16. Everything else has to be image-first,
// then animated - Kling takes its ratio from the image.
const VEO_RATIOS = { landscape: '16:9', story: '9:16', hero: '16:9' };

// The % of each frame the platform covers with its own interface. Anything
// put there is invisible in the wild; Claude composes for the crop.
const UNSAFE = {
  story: { top: 14, bottom: 20, why: 'Stories/Reels UI — profile chip on top, caption and buttons below' },
  tall: { top: 0, bottom: 6, why: 'Pinterest overlay' }
};

// Prompt shape differs by model - Claude needs to know which it's writing for.
const MODEL_NOTES = {
  'gpt-image-2':
    'Follows long, structured, prose prompts. Excellent at layout adherence and at rendering legible text (which we never want). Give it a full described frame.',
  'nano-banana-pro':
    'Google. Strong at subject consistency and illustration. Prefers direct, concrete description over poetry.',
  'nano-banana-edit':
    'EDIT MODEL. It is looking at attached images. The prompt must be an INSTRUCTION relative to them, and must state explicitly what to LEAVE UNTOUCHED, or it will quietly redraw the rest. It is WEAK at rendering text.',
  'gpt-image-2-edit':
    'EDIT MODEL that renders text well. It is looking at attached images. The prompt must be an INSTRUCTION relative to them and must state what to LEAVE UNTOUCHED. Because it can set type, specify the copy verbatim and describe the typography precisely — typeface character, weight, hierarchy, colour, alignment, position.',
  'veo-3.1': 'Video. Describe motion, camera move and duration. 16:9 or 9:16 only.',
  'veo-3.1-fast': 'Video, cheaper. Same shape as Veo 3.1.',
  'kling-3-pro':
    'Animates a still. Keep motion SMALL — describe what moves and what stays. Aspect ratio comes from the source image.',
  'kling-2.1': 'Animates a still, budget. Keep motion small.'
};

// Anthropic. Rates are per MILLION tokens - edit here if they change.
const CLAUDE = { model: 'claude-sonnet-5', in_per_m: 3.0, out_per_m: 15.0 };

// `cost` returns dollars for ONE output given the options; `input` builds
// the fal request body.
const MODELS = {
  'gpt-image-2': {
    kind: 'image',
    label: 'GPT Image 2',
    blurb: 'The all-rounder. Best-in-class at rendering legible text and following a layout. Start here.',
    endpoints: ['fal-ai/gpt-image-2', 'openai/gpt-image-2'],
    qualities: ['low', 'medium', 'high'],
    cost: (o) => ({ low: 0.03, medium: 0.1, high: 0.37 })[o.quality] ?? 0.1,
    input: (p, o) => ({
      prompt: p,
      num_images: 1,
      quality: o.quality,
      image_size: { width: o.w, height: o.h },
      output_format: 'png'
    })
  },

  'nano-banana-pro': {
    kind: 'image',
    label: 'Nano Banana Pro',
    blurb: "Google's. Superb at keeping a subject consistent across a set, and at illustration.",
    endpoints: ['fal-ai/nano-banana-pro'],
    qualities: ['1K', '2K', '4K'],
    cost: () => 0.15,
    input: (p, o) => ({
      prompt: p,
      num_images: 1,
      output_format: 'png',
      resolution: o.quality || '2K',
      aspect_ratio:
        o.h > o.w ? (o.h / o.w > 1.6 ? '9:16' : '3:4') : o.w > o.h ? (o.w / o.h > 1.6 ? '16:9' : '4:3') : '1:1'
    })
  },

  'nano-banana-edit': {
    kind: 'edit',
    label: 'Nano Banana Pro — edit',
    blurb: 'Feed it images and tell it what to change. Refine one, or blend several as references.',
    endpoints: ['fal-ai/nano-banana-pro/edit'],
    cost: () => 0.15,
    input: (p, o) => ({
      prompt: p,
      image_urls: o.image_urls || [o.image_url],
      num_images: 1,
      aspect_ratio: o.aspect || 'auto',
      output_format: 'png',
      resolution: o.quality || '2K'
    })
  },

  // GPT Image 2 can also EDIT, and is markedly better than Nano Banana at
  // rendering legible type - so when mirroring an ad that HAS copy baked
  // in, this is the editor used.
  'gpt-image-2-edit': {
    kind: 'edit',
    label: 'GPT Image 2 — edit',
    blurb: 'Edits an image AND renders text properly. Use this when the ad you’re mirroring has a headline baked in.',
    endpoints: ['openai/gpt-image-2/edit', 'fal-ai/gpt-image-2/edit'],
    qualities: ['low', 'medium', 'high'],
    cost: (o) => ({ low: 0.03, medium: 0.1, high: 0.37 })[o.quality] ?? 0.1,
    input: (p, o) => ({
      prompt: p,
      image_urls: o.image_urls || [o.image_url],
      num_images: 1,
      quality: ['low', 'medium', 'high'].includes(o.quality) ? o.quality : 'medium',
      image_size: { width: o.w || 1024, height: o.h || 1024 },
      output_format: 'png'
    })
  },

  'veo-3.1-fast': {
    kind: 'video',
    label: 'Veo 3.1 Fast',
    blurb: 'Google. Quick and cheap enough to iterate with. 16:9 or 9:16 only.',
    endpoints: ['fal-ai/veo3.1/fast', 'fal-ai/veo3.1/fast/text-to-video'],
    durations: [4, 6, 8],
    cost: (o) => (o.audio ? 0.2 : 0.1) * (o.duration || 8),
    input: (p, o) => ({
      prompt: p,
      duration: String(o.duration || 8) + 's',
      aspect_ratio: o.veoRatio || '16:9',
      resolution: '1080p',
      generate_audio: !!o.audio
    })
  },

  'veo-3.1': {
    kind: 'video',
    label: 'Veo 3.1',
    blurb: 'The good one. Cinematic, native synced audio. Expensive — use it for the hero cut.',
    endpoints: ['fal-ai/veo3.1', 'fal-ai/veo3.1/text-to-video'],
    durations: [4, 6, 8],
    cost: (o) => (o.audio ? 0.4 : 0.2) * (o.duration || 8),
    input: (p, o) => ({
      prompt: p,
      duration: String(o.duration || 8) + 's',
      aspect_ratio: o.veoRatio || '16:9',
      resolution: '1080p',
      generate_audio: !!o.audio
    })
  },

  'kling-3-pro': {
    kind: 'animate',
    label: 'Kling 3.0 Pro',
    blurb:
      'Animates a still. Takes its aspect ratio FROM THE IMAGE — so this is how you get 1:1 and 4:5 video ads, which Veo cannot make.',
    endpoints: ['fal-ai/kling-video/v3/pro/image-to-video'],
    durations: [5, 10],
    cost: (o) => (o.audio ? 0.168 : 0.112) * (o.duration || 5),
    input: (p, o) => ({
      prompt: p,
      start_image_url: o.image_url,
      duration: String(o.duration || 5),
      generate_audio: !!o.audio
    })
  },

  'kling-2.1': {
    kind: 'animate',
    label: 'Kling 2.1 Standard',
    blurb: 'The budget animator. 25¢ for 5 seconds. Good enough for testing an angle.',
    endpoints: ['fal-ai/kling-video/v2.1/standard/image-to-video'],
    durations: [5, 10],
    cost: (o) => 0.25 + 0.05 * ((o.duration || 5) - 5),
    input: (p, o) => ({ prompt: p, image_url: o.image_url, duration: String(o.duration || 5) })
  }
};

const byKind = (k) =>
  Object.entries(MODELS)
    .filter(([, m]) => m.kind === k)
    .map(([id, m]) => ({ id, ...m, cost: undefined, input: undefined }));

// nearest legal aspect_ratio string for the models that take one
const aspectOf = (w, h) => {
  const r = w / h;
  const opts = [
    ['21:9', 2.33], ['16:9', 1.78], ['3:2', 1.5], ['4:3', 1.33], ['1:1', 1],
    ['4:5', 0.8], ['3:4', 0.75], ['2:3', 0.667], ['9:16', 0.5625]
  ];
  return opts.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a))[0];
};

/* ── mode flags ────────────────────────────────────────────── */
const MOCK = process.env.STUDIO_MOCK === '1';
const HAS_CLAUDE = MOCK || !!process.env.ANTHROPIC_API_KEY;

const slug = (s) => (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// a stretched SVG - enough to prove the whole pipeline without a network call
function mockPng(w, h, seed) {
  const c = ['3B82F6', 'F97066', '12B76A', 'FDB022', '6E56F8', '3DDCFF'][seed % 6];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#${c}"/><text x="50%" y="50%" fill="#fff" font-size="${Math.round(w / 12)}" text-anchor="middle" font-family="sans-serif">MOCK ${w}x${h}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
// a tiny valid-enough stub so <video> elements don't crash the mock run
const MOCK_VIDEO = 'data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQ==';

/* ── fal queue REST ────────────────────────────────────────────
   submit() returns immediately; status/result URLs come back in the
   response and are stored on the pending step, so polling needs no
   endpoint reconstruction. */
function falKey() {
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not configured. Add it in Netlify environment variables.');
  return process.env.FAL_KEY;
}

async function falSubmit(endpoint, input) {
  const r = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!r.ok) throw new Error(`fal ${r.status} on ${endpoint} — ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { statusUrl: d.status_url, responseUrl: d.response_url };
}

async function falStatus(pending) {
  const r = await fetch(pending.statusUrl, { headers: { Authorization: `Key ${falKey()}` } });
  if (!r.ok) throw new Error(`fal status ${r.status} — ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).status; // IN_QUEUE | IN_PROGRESS | COMPLETED
}

async function falResult(pending) {
  const r = await fetch(pending.responseUrl, { headers: { Authorization: `Key ${falKey()}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`fal result ${r.status} — ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('fal returned an unreadable result.');
  }
}

// Reference uploads go to fal storage so every model gets a plain https URL.
async function falUpload(buffer, fileName, contentType) {
  if (MOCK) throw new Error('falUpload must not be called in mock mode');
  const init = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate', {
    method: 'POST',
    headers: { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: fileName, content_type: contentType })
  });
  if (!init.ok) throw new Error(`fal upload ${init.status} — ${(await init.text()).slice(0, 200)}`);
  const { upload_url: uploadUrl, file_url: fileUrl } = await init.json();
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: buffer });
  if (!put.ok) throw new Error(`fal upload PUT ${put.status}`);
  return fileUrl;
}

const findUrl = (d) => {
  if (!d) return null;
  const c = [d?.images?.[0]?.url, d?.image?.url, d?.video?.url, d?.videos?.[0]?.url, d?.url].find(Boolean);
  if (c) return c;
  const m = JSON.stringify(d).match(/https?:\/\/[^"']+\.(png|jpe?g|webp|mp4|webm)/i);
  return m ? m[0] : null;
};

async function falBalance() {
  if (MOCK) return { ok: true, balance: 123.45, currency: 'USD', account: 'mock' };
  try {
    const r = await fetch('https://api.fal.ai/v1/account/billing?expand=credits', {
      headers: { Authorization: 'Key ' + (process.env.FAL_ADMIN_KEY || process.env.FAL_KEY || '') }
    });
    if (!r.ok)
      return {
        ok: false,
        status: r.status,
        hint:
          r.status === 401 || r.status === 403
            ? 'fal serves the balance only to an ADMIN key. fal.ai → API Keys → scope: admin → add FAL_ADMIN_KEY in Netlify.'
            : (await r.text()).slice(0, 140)
      };
    const d = await r.json();
    return { ok: true, balance: d?.credits?.current_balance, currency: d?.credits?.currency || 'USD', account: d?.username };
  } catch (e) {
    return { ok: false, hint: String((e && e.message) || e) };
  }
}

/* ════════════════════════════════════════════════════════════
   JOBS - a state machine, saved to the store after every change.
   ════════════════════════════════════════════════════════════ */

// The full prompt for each placement is assembled ONCE at creation (docs and
// brand text come from the store then) and saved on the spec, so the poll
// loop never re-reads documents.
function assemble(spec, pid, docTexts, brandText) {
  const parts = [spec.prompt];
  if (spec.textMode && spec.copy)
    parts.push(`RENDER THIS EXACT COPY IN THE IMAGE, spelled exactly, word for word. Add no other words:\n${spec.copy}`);
  const note = spec.placement_notes && spec.placement_notes[pid];
  if (note) parts.push(`COMPOSITION FOR THIS PLACEMENT (${pid}): ${note}`);
  if (spec.refs && spec.refs.length)
    parts.push(
      'ATTACHED IMAGES: use them exactly as directed above — as the subject, as a reference, or as the thing being edited. Change ONLY what is asked for; leave everything else untouched.'
    );
  const bits = (spec.docs || [])
    .map((name) => (docTexts[name] ? `--- ${name} ---\n` + docTexts[name].slice(0, 6000).trim() : null))
    .filter(Boolean);
  if (bits.length) parts.push('SOURCE MATERIAL:\n\n' + bits.join('\n\n'));
  if (brandText) parts.push('BRAND GUIDELINES — follow these exactly:\n\n' + brandText.trim());
  if (spec.negative) parts.push(`Do NOT include: ${spec.negative}`);
  return parts.filter(Boolean).join('\n\n');
}

function newJob(b, docTexts, brandText) {
  const proj = slug(b.project);
  const id = `${proj}--${stamp()}`;
  const spec = {
    prompt: b.prompt,
    negative: b.negative || '',
    brand: b.brand || '',
    docs: b.docs || [],
    refs: b.refs || [],
    model: b.model,
    quality: b.quality,
    variants: Math.max(1, +b.variants || 1),
    placements: b.placements || [],
    duration: +b.duration || 8,
    audio: !!b.audio,
    animate: !!b.animate,
    animateModel: b.animateModel || 'kling-3-pro',
    placement_notes: b.placement_notes || {},
    draft: !!b.draft,
    textMode: !!b.textMode,
    copy: b.copy || ''
  };
  spec.assembled = Object.fromEntries(spec.placements.map((pid) => [pid, assemble(spec, pid, docTexts, brandText)]));
  return {
    id,
    project: proj,
    state: 'queued',
    spec,
    items: Object.fromEntries(spec.placements.map((p) => [p, { state: 'queued', files: [], error: null }])),
    created: Date.now(),
    updated: Date.now()
  };
}

// Submit one fal request for an item and record it as pending. In mock mode
// the "request" completes on the next poll tick, which exercises the same
// path a real render takes.
async function submitStep(job, item, kind, modelId, prompt, opts) {
  const m = MODELS[modelId];
  const endpoints = m.endpoints;
  if (MOCK) {
    job.mockSeed = (job.mockSeed || 0) + 1;
    item.pending = {
      kind,
      mock: kind === 'image' ? mockPng(opts.w || 1024, opts.h || 1024, job.mockSeed) : MOCK_VIDEO
    };
    return;
  }
  const input = m.input(prompt, opts);
  let last;
  for (let i = 0; i < endpoints.length; i++) {
    try {
      const sub = await falSubmit(endpoints[i], input);
      item.pending = { kind, endpoints, epIndex: i, input, ...sub };
      return;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// One tick for one placement. Never throws for per-frame failures - a
// failure here must never touch another frame.
async function advancePlacement(job, pid) {
  const item = job.items[pid];
  if (!item || item.state === 'done' || item.state === 'error') return;
  const s = job.spec;
  const P = PLACEMENTS.find((x) => x.id === pid);
  const m = MODELS[s.model];
  const prompt = (s.assembled && s.assembled[pid]) || s.prompt;
  const useRefs = s.refs.length > 0 && m.kind !== 'video';
  // Nano Banana can't set type. If the copy has to appear IN the image,
  // edit with GPT Image 2 instead - that's the one that renders text.
  const editor = s.textMode ? 'gpt-image-2-edit' : 'nano-banana-edit';
  item.state = 'generating';

  try {
    // 1) settle a pending request, if any
    if (item.pending) {
      const p = item.pending;
      if (p.mock) {
        item.files.push({ url: p.mock, video: p.kind !== 'image' });
        item.pending = null;
      } else {
        const status = await falStatus(p);
        if (status !== 'COMPLETED') return; // still rendering - next tick
        let url = null;
        let failure = null;
        try {
          url = findUrl(await falResult(p));
          if (!url) failure = new Error('no output url from ' + p.endpoints[p.epIndex]);
        } catch (e) {
          failure = e;
        }
        if (failure) {
          // same fallback the original had: try the model's next endpoint
          if (p.epIndex + 1 < p.endpoints.length) {
            const sub = await falSubmit(p.endpoints[p.epIndex + 1], p.input);
            item.pending = { ...p, epIndex: p.epIndex + 1, ...sub };
            return;
          }
          throw failure;
        }
        item.files.push({ url, video: p.kind !== 'image' });
        item.pending = null;
      }
    }

    // 2) submit the next step, or finish
    const images = item.files.filter((f) => !f.video);
    const clips = item.files.filter((f) => f.video);

    if (m.kind === 'video') {
      if (useRefs) throw new Error('Reference images attached — use Ads + motion, not text-to-video.');
      const ratio = VEO_RATIOS[pid];
      if (!ratio)
        throw new Error(`Veo can't render ${P.ratio}. Use an Ad set with "add motion" — Kling takes its ratio from the image.`);
      if (clips.length >= s.variants) {
        item.state = 'done';
        return;
      }
      await submitStep(job, item, 'video', s.model, prompt, { duration: s.duration, audio: s.audio, veoRatio: ratio });
      return;
    }

    if (images.length < s.variants) {
      // fail the story frame exactly once in mock, so the retry path is exercised
      if (MOCK && P.h === 1808 && !job.mockFailedOnce) {
        job.mockFailedOnce = true;
        throw new Error('MOCK: simulated failure on this frame — press Retry');
      }
      if (useRefs) {
        await submitStep(job, item, 'image', editor, prompt, {
          image_urls: s.refs,
          aspect: aspectOf(P.w, P.h),
          w: P.w,
          h: P.h,
          quality: s.textMode
            ? ['low', 'medium', 'high'].includes(s.quality) ? s.quality : 'medium'
            : ['1K', '2K', '4K'].includes(s.quality) ? s.quality : '2K'
        });
      } else {
        await submitStep(job, item, 'image', s.model, prompt, { quality: s.quality, w: P.w, h: P.h });
      }
      return;
    }

    if (s.animate && clips.length < images.length) {
      // animate the next still that has no clip yet - its URL is already
      // fal-hosted, so no re-upload is needed
      await submitStep(job, item, 'clip', s.animateModel, prompt, {
        image_url: images[clips.length].url,
        duration: Math.min(s.duration, 10),
        audio: s.audio
      });
      return;
    }

    item.state = 'done';
  } catch (e) {
    item.pending = null;
    item.state = 'error';
    item.error = String((e && e.message) || e);
  }
}

// One poll tick for the whole job: advance every placement (they render in
// parallel - each is one queued fal request), then settle the job state.
async function advanceJob(job) {
  if (job.state !== 'queued' && job.state !== 'generating') return job;
  job.state = 'generating';
  await Promise.all(Object.keys(job.items).map((pid) => advancePlacement(job, pid)));
  const vals = Object.values(job.items);
  if (vals.every((i) => i.state === 'done' || i.state === 'error')) {
    const err = vals.some((i) => i.state === 'error');
    const ok = vals.some((i) => i.state === 'done');
    job.state = ok ? (err ? 'partial' : 'done') : 'error';
  }
  job.updated = Date.now();
  return job;
}

/* ── EDIT CHAINS - an edit never destroys its source ────────── */
async function advanceChain(chain) {
  const p = chain.pending;
  if (!p) return chain;
  try {
    if (MOCK) {
      chain.mockSeed = (chain.mockSeed || 0) + 1;
      p.made = Array.from({ length: p.n }, (_, i) => mockPng(1024, 1024, chain.mockSeed + i));
    } else {
      for (const req of p.requests) {
        if (req.url) continue;
        const status = await falStatus(req);
        if (status !== 'COMPLETED') return chain; // not all done - next tick
        const url = findUrl(await falResult(req));
        if (!url) throw new Error('no output url from the edit model');
        req.url = url;
      }
      p.made = p.requests.map((r) => r.url);
    }
    chain.steps.push({
      i: chain.steps.length,
      parent: p.parent != null ? p.parent : chain.steps.length ? chain.steps.length - 1 : null,
      src: p.src,
      refs: p.refs,
      instruction: p.instruction,
      results: p.made,
      at: Date.now()
    });
    chain.pending = null;
  } catch (e) {
    chain.pending = null;
    chain.error = String((e && e.message) || e);
  }
  return chain;
}

/* ── MOTION - animate a finished still ──────────────────────── */
async function advanceMotion(rec) {
  if (rec.state !== 'generating' || !rec.pending) return rec;
  try {
    if (rec.pending.mock) {
      rec.url = MOCK_VIDEO;
      rec.state = 'done';
      rec.pending = null;
      return rec;
    }
    const status = await falStatus(rec.pending);
    if (status !== 'COMPLETED') return rec;
    const url = findUrl(await falResult(rec.pending));
    if (!url) throw new Error('no output url from the animate model');
    rec.url = url;
    rec.state = 'done';
    rec.pending = null;
  } catch (e) {
    rec.pending = null;
    rec.state = 'error';
    rec.error = String((e && e.message) || e);
  }
  return rec;
}

/* ════════════════════════════════════════════════════════════
   CLAUDE - the prompt studio
   ════════════════════════════════════════════════════════════ */
const RULES_NO_TEXT = `2. NEVER TEXT IN THE IMAGE. Copy is overlaid later by a designer in a real typeface. The negative prompt MUST block: text, letters, words, numbers, captions, watermarks, logos, signage. Do NOT reserve empty boxes, panels or bars for copy — an empty rectangle in a render is a defect, not a placeholder. Compose so a headline can be laid over open, quiet space later.`;

const RULES_TEXT = `2. RENDER THE COPY INTO THE IMAGE. The user has supplied the exact words. Use them VERBATIM — do not rewrite, shorten, or invent a single word, and do not add any copy they did not give you.
   Specify the typography explicitly, as a designer would: typeface character (e.g. high-contrast transitional serif, or geometric grotesque), weight, the size hierarchy between lines, colour, alignment, letter-spacing, and exactly where the block sits in the frame.
   If a button or CTA is supplied, describe it as a real button: shape, corner radius, fill colour, the label inside it.
   The negative prompt must NOT block text. It should still block: watermarks, unrelated logos, gibberish text, misspelled words, duplicate or ghosted text.
   Never leave an empty panel or bar where copy should be. Either the words are in it, or it does not exist.`;

const sysPrompt = (textMode) => `You are a working art director writing production prompts for image and video generators. You are not a thesaurus and you are not a copywriter. Your job is to turn a vague brief into a frame someone could actually shoot.

RULES — all of them, every time:

1. SPECIFICITY. "An insurance ad" is not a prompt. A described frame is. Always state, explicitly:
   - the subject, and what the subject is DOING
   - camera angle and distance
   - lens character
   - lighting: direction, quality, colour temperature, time of day
   - palette, in specifics
   - material and texture
   - depth of field
   - mood
   - colour grade

${textMode ? RULES_TEXT : RULES_NO_TEXT}

3. THE BRAND GUIDELINES OUTRANK YOUR TASTE. If the brand says people are never shot smiling at camera, they are not — regardless of what you would prefer.

4. COMPOSE FOR THE CROP, NOT THE CANVAS. Each placement has unsafe zones: the percentage of the frame the platform covers with its own interface. A 9:16 story loses roughly the top 14% and the bottom 20%. Anything there is invisible in the wild. The subject — and any copy — must survive that crop in every ratio.

5. IF REFERENCE IMAGES ARE ATTACHED, THE JOB IS EDIT/BLEND — not generation from nothing. LOOK AT THEM. The prompt must be an INSTRUCTION relative to those images, and it must state explicitly WHAT TO LEAVE UNTOUCHED. Edit models quietly redraw everything you do not pin down.
   If the user says "mirror this layout", treat the reference as a TEMPLATE: keep its composition, its type hierarchy, its colour logic and its crop, and change only what they asked to change.

6. If source documents are supplied, mine them for the offer, the audience, the product and the tone. Do not restate the brief — render it.

7. Do not invent brand names, real people, statistics or claims.

8. KEEP placement_notes SHORT — one or two sentences each. Long notes get truncated and break the response.

9. Return JSON. Only JSON. No markdown, no fences, no preamble.

Shape:
{
  "prompt": "the full production prompt",
  "negative": "the keep-out list, expanded with this model's known failure habits",
  "placement_notes": { "<placement-id>": "one or two sentences: how to compose FOR THIS RATIO" },
  "reasoning": "2-3 lines. What you inferred and why."
}`;

async function callClaude(content, maxTokens = 4096, textMode = false) {
  if (MOCK) {
    const copy = textMode ? 'How much do you really need to retire?' : null;
    return {
      text: JSON.stringify({
        prompt: copy
          ? `MOCK EXPANSION (TEXT MODE) — Mirror the reference layout exactly. Set the headline "${copy}" across the upper third in a high-contrast transitional serif, mixed weights, deep navy on a soft sky gradient, centred, generous leading. Below it a navy pill button, fully rounded, white label. Beneath, a Singaporean couple in their sixties on a sofa, warm daylight, HDB balcony and greenery behind. Editorial, calm, unsalesy.`
          : 'MOCK EXPANSION — A man in his late fifties stands on the open-air corridor of an older HDB block, seen from behind, forearms on the ledge, looking out over the estate. Late golden-hour light rakes across the concrete. 50mm, mid distance, shallow depth of field. Amber, dusty ochre, cool concrete grey. Matte filmic grain, no HDR.',
        negative: copy
          ? 'watermarks, unrelated logos, gibberish text, misspelled words, duplicate or ghosted text, empty placeholder boxes, extra fingers, HDR, oversaturation'
          : 'text, letters, words, numbers, captions, watermarks, logos, signage, empty placeholder boxes, smiling at camera, handshakes, thumbs up, extra fingers, deformed hands, HDR, oversaturation, lens flare',
        placement_notes: {
          square: 'Subject centre-left on the third. Full frame usable.',
          portrait: 'Subject in the lower-middle third; leave the top open for sky.',
          story:
            'Subject centred between 14% and 80% of the frame height — the top 14% and bottom 20% are covered by the Stories UI and must stay empty.',
          landscape: 'Subject on the left third, estate sweeping right. Full frame usable.',
          wide: 'Subject far left, long negative space right.',
          tall: 'Subject in the upper two-thirds; keep the bottom 6% clear.',
          hero: 'Subject right of centre; left third empty for a headline.'
        },
        reasoning:
          "MOCK. Read the brief for audience and tone, obeyed the brand's no-smiling-at-camera rule, and pushed the subject out of the Story unsafe zones."
      }),
      usage: { input_tokens: 1840, output_tokens: 410 },
      cost: (1840 / 1e6) * CLAUDE.in_per_m + (410 / 1e6) * CLAUDE.out_per_m
    };
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: CLAUDE.model,
      max_tokens: maxTokens,
      system: sysPrompt(textMode),
      messages: [{ role: 'user', content }]
    })
  });
  if (!r.ok) throw new Error(`Claude ${r.status} — ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  const text = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const u = d.usage || {};
  const cost = ((u.input_tokens || 0) / 1e6) * CLAUDE.in_per_m + ((u.output_tokens || 0) / 1e6) * CLAUDE.out_per_m;
  return { text, usage: u, cost };
}

// Claude is told to return bare JSON. It usually does. Parse as if it didn't -
// including the case where the reply was CUT OFF mid-object.
function parseJson(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  if (a > 0) t = t.slice(a);

  try {
    return JSON.parse(t);
  } catch {}

  // truncated? close whatever is still open and try again.
  try {
    let repaired = t;
    if (/[:,]\s*"[^"]*$/.test(repaired)) repaired += '"';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (const c of repaired) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      if (c === '}') depth--;
    }
    repaired = repaired.replace(/,\s*$/, '');
    while (depth-- > 0) repaired += '}';
    return JSON.parse(repaired);
  } catch {}

  throw new Error("Claude's reply couldn't be parsed as JSON. Press it again — this is usually a one-off.");
}

// An Anthropic image block from either a hosted URL (fal CDN) or a data URI
// (mock mode uploads). Returns null for anything unreadable - callers skip it.
function imageBlock(url) {
  const u = String(url || '');
  if (/^https?:\/\//i.test(u)) return { type: 'image', source: { type: 'url', url: u } };
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(u);
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  return null;
}

/* ── shared handler plumbing ─────────────────────────────────── */
const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

module.exports = {
  PLACEMENTS,
  VEO_RATIOS,
  UNSAFE,
  MODEL_NOTES,
  CLAUDE,
  MODELS,
  byKind,
  aspectOf,
  MOCK,
  HAS_CLAUDE,
  slug,
  stamp,
  newJob,
  advanceJob,
  advanceChain,
  advanceMotion,
  falSubmit,
  falUpload,
  falBalance,
  findUrl,
  callClaude,
  parseJson,
  imageBlock,
  MOCK_VIDEO,
  mockPng,
  json
};
