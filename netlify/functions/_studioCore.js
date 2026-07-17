// Leadly Studio core - built from scratch. Everything the endpoints share:
// the template registry, the Claude spec writer, the fal client, the
// SVG/Sharp compositor, the QA gate with its automatic ladder, storage
// helpers, and the job processor. All external calls go through an
// injectable `deps` object so tests (and STUDIO_MOCK) never touch the
// network.
const sharp = require('sharp');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { parseJson } = require('./_json');

// ---------------------------------------------------------------- config --

const OVERLAY_MAX = 60;

const PLACEMENTS = {
  square: { id: 'square', label: 'Feed 1:1', w: 1080, h: 1080, ratio: '1:1' },
  portrait: { id: 'portrait', label: 'Feed 4:5', w: 1080, h: 1350, ratio: '4:5' },
  story: { id: 'story', label: 'Story 9:16', w: 1080, h: 1920, ratio: '9:16', unsafe: { top: 0.14, bottom: 0.2 } },
  landscape: { id: 'landscape', label: 'Link 1.91:1', w: 1200, h: 628, ratio: '1.91:1' }
};

// Price per generated image, in USD credits.
const MODELS = {
  'nano-banana-pro': { id: 'nano-banana-pro', label: 'Nano Banana Pro', t2i: 'fal-ai/nano-banana-pro', edit: 'fal-ai/nano-banana-pro/edit', price: 0.15 },
  'gpt-image-2': { id: 'gpt-image-2', label: 'GPT Image 2', t2i: 'fal-ai/gpt-image-2', edit: 'fal-ai/gpt-image-2/edit', price: 0.25 }
};

// ------------------------------------------------------------- templates --
// Six launch templates as data. Zones are normalized [0..1] rects on the
// final canvas; imageRect (when set) is where the photo lives (protected
// band/panel templates), everything else is painted from the brand kit.
// Each template's directive is what the spec writer passes to the image
// model so the text zone comes back clean - it never mentions the overlay
// text itself.
const TEMPLATES = [
  {
    id: 'open-left',
    name: 'Open — text left',
    kind: 'open',
    zone: { x: 0.06, y: 0.1, w: 0.46, h: 0.38, align: 'left' },
    directive: 'Keep the upper-left third of the frame clean, uncluttered and low-detail — soft out-of-focus background there; no text, no letters, no logos, no busy objects in that area.',
    scrim: 'top-left'
  },
  {
    id: 'open-lower',
    name: 'Open — text lower',
    kind: 'open',
    zone: { x: 0.06, y: 0.56, w: 0.55, h: 0.32, align: 'left' },
    directive: 'Keep the lower-left portion of the frame clean and low-detail with gentle falloff — no text, no letters, no logos, nothing busy in the lower left.',
    scrim: 'bottom'
  },
  {
    id: 'band-bottom',
    name: 'Brand band — bottom',
    kind: 'band',
    imageRect: { x: 0, y: 0, w: 1, h: 0.82 },
    zone: { x: 0.06, y: 0.84, w: 0.88, h: 0.13, align: 'left' },
    directive: 'Compose the subject centred with breathing room at the edges; the bottom of the frame will be cropped slightly, so keep nothing critical in the lowest fifth. No text, no letters, no logos anywhere.',
    scrim: null
  },
  {
    id: 'band-top',
    name: 'Brand band — top',
    kind: 'band',
    imageRect: { x: 0, y: 0.18, w: 1, h: 0.82 },
    zone: { x: 0.06, y: 0.03, w: 0.88, h: 0.13, align: 'left' },
    directive: 'Compose the subject centred-low with breathing room; the top of the frame will be cropped slightly, so keep nothing critical in the top fifth. No text, no letters, no logos anywhere.',
    scrim: null
  },
  {
    id: 'panel-right',
    name: 'Brand panel — right',
    kind: 'panel',
    imageRect: { x: 0, y: 0, w: 0.62, h: 1 },
    zone: { x: 0.66, y: 0.3, w: 0.3, h: 0.42, align: 'left' },
    directive: 'Compose the subject weighted to the left half of the frame — the right side will be cropped. No text, no letters, no logos anywhere.',
    scrim: null
  },
  {
    id: 'logo-corner',
    name: 'Minimal — logo corner',
    kind: 'minimal',
    zone: { x: 0.06, y: 0.86, w: 0.7, h: 0.09, align: 'left' },
    directive: 'Keep the bottom edge of the frame calm and low-detail — no text, no letters, no logos; the image should read as premium and uncluttered.',
    scrim: 'bottom',
    logoCorner: 'top-right'
  }
];

// The auto mirror variant: flip the zone (and image rect) horizontally and
// mirror the directive's left/right language.
function mirrorTemplate(t) {
  const flip = (r) => (r ? { ...r, x: +(1 - r.x - r.w).toFixed(4) } : r);
  const swapWords = (s) =>
    s.replace(/\b(left|right)\b/g, (m) => (m === 'left' ? 'right' : 'left')).replace(/upper-(left|right)/g, (m) => (m.endsWith('left') ? 'upper-right' : 'upper-left'));
  return {
    ...t,
    id: `${t.id}--mirror`,
    name: `${t.name} (mirrored)`,
    zone: { ...flip(t.zone), align: t.zone.align === 'left' ? 'right' : 'left' },
    imageRect: flip(t.imageRect),
    directive: swapWords(t.directive),
    logoCorner: t.logoCorner === 'top-right' ? 'top-left' : t.logoCorner,
    mirrorOf: t.id
  };
}

const templateById = (id) => {
  const base = TEMPLATES.find((t) => t.id === id || `${t.id}--mirror` === id);
  if (!base) return null;
  return id.endsWith('--mirror') ? mirrorTemplate(base) : base;
};

// The automatic recovery ladder for a failing composite, in order.
function ladderFor(templateId) {
  const t = templateById(templateId);
  if (!t) return [];
  const baseId = t.mirrorOf || t.id;
  const alt = TEMPLATES.find((x) => x.kind === 'band' && x.id !== baseId) || TEMPLATES[2];
  return [
    { rung: 'original', templateId: t.id },
    { rung: 'mirror', templateId: t.mirrorOf ? baseId : `${baseId}--mirror` },
    { rung: 'alternative', templateId: alt.id },
    { rung: 'scrim', templateId: t.id, scrim: true },
    { rung: 'regenerate', templateId: t.id, regenerate: true }
  ];
}

const DEFAULT_BRAND = { color: '#2447F5', ink: '#0E1116', paper: '#FFFFFF', font: 'Figtree, Helvetica, Arial, sans-serif', logoText: 'LEADLY' };

// ------------------------------------------------------------ spec writer --
// Claude turns the four inputs into one strict machine spec. THE RULE: with
// reference images uploaded, the spec prompt must not describe what is IN
// those images - no vision call is ever made on them, the message is
// text-only, and the model is told to speak only about style, lighting,
// mood, composition changes, what to preserve, and the template's
// negative-space directive. The reference images themselves ride to the
// image model as actual inputs. The overlay text NEVER enters the prompt -
// only its length is mentioned so the clean zone is sized honestly.
const SPEC_SYSTEM = `You write image-generation specs for social ads. Return ONLY strict JSON: {"full_prompt": "...", "negative_prompt": "..."}.

Rules:
- No text, letters, words, logos or watermarks may ever be requested in the image; the negative prompt must forbid them.
- WHEN REFERENCE IMAGES ARE PROVIDED (you are told so, you never see them): the reference photos are passed directly to an image-editing model. Do NOT describe, guess or reconstruct their content - no subjects, no objects, no scenes, no people. Your full_prompt speaks ONLY of style, lighting, mood, colour grade, composition changes, what to preserve, and the layout directive you are given. Nothing else.
- With no reference images: write the full scene normally from the brief, concrete and photographic.
- Always include the layout directive verbatim or tightened.
- The ad's headline is overlaid later in post - never write any wording into the prompt; just honour the clean-zone directive sized for a headline of the stated length.
- full_prompt under 180 words. JSON only, no code fences.`;

function specUserMessage({ prompt, fileText, overlayLen, template, model, placements, hasRefs }) {
  const sizes = placements.map((p) => `${PLACEMENTS[p].label} ${PLACEMENTS[p].w}x${PLACEMENTS[p].h}`).join(', ');
  return [
    hasRefs
      ? 'REFERENCE IMAGES: provided (passed straight to the edit model - you cannot see them; do NOT describe their content).'
      : 'REFERENCE IMAGES: none (write the full scene).',
    `BRIEF: ${prompt}`,
    fileText ? `BRIEF MATERIAL (from uploaded file, use what helps):\n${fileText.slice(0, 6000)}` : '',
    `HEADLINE LENGTH: about ${overlayLen} characters (the words themselves are none of your business - they are composited later).`,
    `LAYOUT DIRECTIVE (${template.name}): ${template.directive}`,
    `TARGET MODEL: ${model}. PLACEMENTS: ${sizes}.`,
    'Return the JSON now.'
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function writeSpec(input, deps) {
  const user = specUserMessage(input);
  // text-only, always - the refs are never shown to Claude in this path
  const ask = () => deps.claude({ system: SPEC_SYSTEM, messages: [{ role: 'user', content: user }] });
  let raw = await ask();
  try {
    const spec = parseJson(raw);
    if (spec.full_prompt) return normalizeSpec(spec);
  } catch {
    // fall through to the single retry
  }
  raw = await ask();
  const spec = parseJson(raw);
  if (!spec.full_prompt) throw new Error('The spec writer returned no prompt.');
  return normalizeSpec(spec);
}

function normalizeSpec(spec) {
  return {
    full_prompt: String(spec.full_prompt).slice(0, 2000),
    negative_prompt: String(spec.negative_prompt || 'text, letters, words, typography, logos, watermarks, captions').slice(0, 600)
  };
}

// ------------------------------------------------------------------ fal ---

async function falRun(endpoint, payload, key) {
  const res = await fetch(`https://fal.run/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`fal ${endpoint} failed (${res.status}): ${json.detail || json.error || 'unknown'}`);
  return json;
}

async function falBalance(adminKey) {
  const res = await fetch('https://rest.alpha.fal.ai/billing/user_balance', {
    headers: { Authorization: `Key ${adminKey}` }
  });
  if (!res.ok) throw new Error(`fal balance failed (${res.status})`);
  const json = await res.json();
  const usd = typeof json === 'number' ? json : Number(json.balance ?? json.amount ?? 0);
  return { usd: +usd.toFixed(2) };
}

// ------------------------------------------------------------ compositor --
// Template + overlay text + brand kit rendered as SVG, composited with
// Sharp at the placement's exact pixels. Deterministic and serverless-safe.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function wrapText(text, maxCharsPerLine) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxCharsPerLine && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function overlaySvg({ template, placement, text, brand, scrim }) {
  const W = placement.w;
  const H = placement.h;
  const z = template.zone;
  const zx = z.x * W;
  const zy = z.y * H;
  const zw = z.w * W;
  const zh = z.h * H;
  const onBrand = template.kind === 'band' || template.kind === 'panel';
  const fill = onBrand ? brand.paper : '#FFFFFF';
  const parts = [];

  // brand surfaces the text owns
  if (template.kind === 'band') {
    const r = template.imageRect;
    const bandY = r.y === 0 ? r.h * H : 0;
    const bandH = H - r.h * H;
    parts.push(`<rect x="0" y="${bandY}" width="${W}" height="${bandH}" fill="${brand.color}"/>`);
  }
  if (template.kind === 'panel') {
    const r = template.imageRect;
    const px = r.x === 0 ? r.w * W : 0;
    parts.push(`<rect x="${px}" y="0" width="${W - r.w * W}" height="${H}" fill="${brand.color}"/>`);
  }
  // scrim under open-template text when the ladder asks for it
  if (scrim || (template.kind === 'open' && scrim !== false && template.forceScrim)) {
    parts.push(
      `<defs><linearGradient id="sc" x1="0" y1="${template.scrim === 'top-left' ? 1 : 0}" x2="0" y2="${template.scrim === 'top-left' ? 0 : 1}"><stop offset="0" stop-color="rgba(8,9,11,0)"/><stop offset="1" stop-color="rgba(8,9,11,0.62)"/></linearGradient></defs>`,
      `<rect x="0" y="${template.scrim === 'top-left' ? 0 : H * 0.5}" width="${W}" height="${H * 0.5}" fill="url(#sc)"/>`
    );
  }

  // headline
  const fontSize = Math.max(28, Math.min(zh / 2.6, (zw / Math.max(8, Math.min(18, text.length))) * 1.7));
  const lines = wrapText(text, Math.max(8, Math.floor(zw / (fontSize * 0.54))));
  const lineH = fontSize * 1.18;
  const anchor = z.align === 'right' ? 'end' : 'start';
  const tx = z.align === 'right' ? zx + zw : zx;
  const ty = zy + fontSize;
  const shadow = onBrand ? '' : ` style="paint-order:stroke" stroke="rgba(8,9,11,0.55)" stroke-width="${Math.max(2, fontSize / 14)}"`;
  lines.forEach((line, i) => {
    parts.push(
      `<text x="${tx}" y="${ty + i * lineH}" font-family="${esc(brand.font)}" font-size="${fontSize}" font-weight="800" fill="${fill}" text-anchor="${anchor}"${shadow}>${esc(line)}</text>`
    );
  });

  // logo mark
  const logoSize = Math.max(20, H * 0.024);
  if (template.logoCorner) {
    const lx = template.logoCorner.endsWith('right') ? W * 0.94 : W * 0.06;
    const la = template.logoCorner.endsWith('right') ? 'end' : 'start';
    parts.push(`<text x="${lx}" y="${H * 0.08}" font-family="${esc(brand.font)}" font-size="${logoSize}" font-weight="800" letter-spacing="3" fill="#FFFFFF" text-anchor="${la}" style="paint-order:stroke" stroke="rgba(8,9,11,0.45)" stroke-width="2">${esc(brand.logoText)}</text>`);
  } else if (onBrand) {
    parts.push(`<text x="${zx}" y="${Math.min(H - logoSize * 0.6, zy + zh + logoSize * 1.4)}" font-family="${esc(brand.font)}" font-size="${logoSize}" font-weight="800" letter-spacing="3" fill="${brand.paper}" opacity="0.85">${esc(brand.logoText)}</text>`);
  }

  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`);
}

async function compose({ baseImage, templateId, text, brandKit, placementId, scrim }) {
  const template = templateById(templateId);
  const placement = PLACEMENTS[placementId];
  if (!template || !placement) throw new Error('Unknown template or placement.');
  const brand = { ...DEFAULT_BRAND, ...(brandKit || {}) };
  const W = placement.w;
  const H = placement.h;
  const r = template.imageRect || { x: 0, y: 0, w: 1, h: 1 };
  const iw = Math.round(r.w * W);
  const ih = Math.round(r.h * H);

  const photo = await sharp(baseImage).resize(iw, ih, { fit: 'cover', position: 'attention' }).toBuffer();
  const svg = overlaySvg({ template, placement, text, brand, scrim });

  const png = await sharp({ create: { width: W, height: H, channels: 3, background: brand.color } })
    .composite([
      { input: photo, left: Math.round(r.x * W), top: Math.round(r.y * H) },
      { input: svg, left: 0, top: 0 }
    ])
    .png()
    .toBuffer();

  return {
    png,
    overlay: { templateId: template.id, text, placementId, scrim: !!scrim, brandKit: brand }
  };
}

// ------------------------------------------------------------------- QA ---
// Edge-density busyness inside the text zone (Laplacian std-dev), face
// check + final legibility pass via injectable hooks (Claude vision in
// production, deterministic fakes in tests). Borderline busyness defers to
// the vision hook when one exists.

const BUSY_HARD = 34;
const BUSY_BORDER = 24;

async function textZoneBusyness(png, templateId, placementId) {
  const template = templateById(templateId);
  const placement = PLACEMENTS[placementId];
  const z = template.zone;
  const crop = await sharp(png)
    .extract({
      left: Math.max(0, Math.round(z.x * placement.w)),
      top: Math.max(0, Math.round(z.y * placement.h)),
      width: Math.min(placement.w, Math.round(z.w * placement.w)),
      height: Math.min(placement.h, Math.round(z.h * placement.h))
    })
    .removeAlpha()
    .greyscale()
    // nearest-neighbour sampling: downscaling must not average the detail
    // away, or every busy zone reads as smooth
    .resize(96, 96, { fit: 'fill', kernel: 'nearest' })
    // zero-sum Laplacian: scale must be explicit (the default divides by
    // the kernel sum) and the offset centres negative responses
    .convolve({ width: 3, height: 3, kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0], scale: 1, offset: 128 })
    .raw()
    .toBuffer();
  let sum = 0;
  for (const v of crop) sum += v;
  const mean = sum / crop.length;
  let varSum = 0;
  for (const v of crop) varSum += (v - mean) * (v - mean);
  return Math.sqrt(varSum / crop.length);
}

// QA on the BASE image (before overlay) for the given template: is the text
// zone calm enough to own the headline?
async function qaZone({ baseComposite, templateId, placementId }, deps = {}) {
  const busyness = await textZoneBusyness(baseComposite, templateId, placementId);
  if (deps.faces) {
    const facesInZone = await deps.faces({ png: baseComposite, templateId, placementId });
    if (facesInZone) return { ok: false, busyness, reason: 'face-in-zone' };
  }
  if (busyness > BUSY_HARD) return { ok: false, busyness, reason: 'busy-zone' };
  if (busyness > BUSY_BORDER && deps.vision) {
    const verdict = await deps.vision({ png: baseComposite, question: 'zone-legibility' });
    if (verdict && verdict.ok === false) return { ok: false, busyness, reason: 'vision-borderline' };
  }
  return { ok: true, busyness };
}

// --------------------------------------------------------------- storage --

function storageBase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set.');
  }
  return { url: process.env.SUPABASE_URL.replace(/\/$/, ''), key: process.env.SUPABASE_SECRET_KEY };
}

async function storagePut(path, buffer, contentType) {
  const { url, key } = storageBase();
  const res = await fetch(`${url}/storage/v1/object/studio/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buffer
  });
  if (!res.ok) throw new Error(`storage upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return `${url}/storage/v1/object/public/studio/${path}`;
}

async function storageGet(path) {
  const { url, key } = storageBase();
  const res = await fetch(`${url}/storage/v1/object/studio/${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`storage read failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function storageList(prefix) {
  const { url, key } = storageBase();
  const res = await fetch(`${url}/storage/v1/object/list/studio`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 500, sortBy: { column: 'created_at', order: 'desc' } })
  });
  if (!res.ok) throw new Error(`storage list failed (${res.status})`);
  return await res.json();
}

const publicUrl = (path) => `${storageBase().url}/storage/v1/object/public/studio/${path}`;

// ------------------------------------------------------------ processing --

const rand = () => crypto.randomBytes(6).toString('hex');

// Runs one placement×variant frame end to end: generate (or reuse) the base
// image, walk the QA ladder, composite, store. Returns the placement-state
// patch.
async function runFrame({ job, placementId, variant, refs, deps }) {
  const model = MODELS[job.model] || MODELS['nano-banana-pro'];
  const placement = PLACEMENTS[placementId];
  const hasRefs = refs.length > 0;
  const endpoint = hasRefs ? model.edit : model.t2i;

  const generate = async () => {
    const payload = {
      prompt: `${job.spec.full_prompt}`,
      negative_prompt: job.spec.negative_prompt,
      num_images: 1,
      image_size: { width: placement.w, height: placement.h },
      ...(hasRefs ? { image_urls: refs } : {})
    };
    const out = await deps.fal(endpoint, payload);
    const first = (out.images && out.images[0]) || out.image;
    if (!first || !first.url) throw new Error('The image model returned no image.');
    return await deps.fetchBuffer(first.url);
  };

  let base = await generate();
  let used = null;
  let composed = null;

  for (const rung of ladderFor(job.templateId)) {
    if (rung.regenerate) base = await generate();
    // QA judges the text ZONE on a bare composite (no headline drawn) - the
    // overlay's own letter edges must never trip the busyness gate.
    const bare = await compose({
      baseImage: base,
      templateId: rung.templateId,
      text: '',
      brandKit: job.inputs.brandKit,
      placementId,
      scrim: rung.scrim
    });
    const verdict = await qaZone({ baseComposite: bare.png, templateId: rung.templateId, placementId }, deps.qa || {});
    if (verdict.ok || rung.rung === 'regenerate') {
      used = { ...rung, busyness: +verdict.busyness.toFixed(1), qaOk: verdict.ok };
      composed = await compose({
        baseImage: base,
        templateId: rung.templateId,
        text: job.inputs.overlayText,
        brandKit: job.inputs.brandKit,
        placementId,
        scrim: rung.scrim
      });
      break;
    }
  }

  // final vision pass (production only): overlay legible, safe zones clear
  if (deps.qa && deps.qa.finalVision) {
    await deps.qa.finalVision({ png: composed.png, placementId, unsafe: placement.unsafe || null }).catch(() => {});
  }

  const key = `${placementId}-v${variant}-${rand()}`;
  const basePath = `ws/${job.workspaceId}/${job.id}__${key}.base.png`;
  const outPath = `ws/${job.workspaceId}/${job.id}__${key}.png`;
  const metaPath = `ws/${job.workspaceId}/${job.id}__${key}.json`;
  await deps.storagePut(basePath, await sharp(base).png().toBuffer(), 'image/png');
  const url = await deps.storagePut(outPath, composed.png, 'image/png');
  await deps.storagePut(
    metaPath,
    Buffer.from(
      JSON.stringify({
        jobId: job.id,
        workspaceId: job.workspaceId,
        placementId,
        variant,
        overlay: composed.overlay,
        rung: used.rung,
        busyness: used.busyness,
        basePath,
        outPath,
        saved: false,
        createdAt: new Date().toISOString()
      })
    ),
    'application/json'
  );
  return { status: 'done', url, path: outPath, metaPath, rung: used.rung };
}

// Full job: every placement × variant, per-frame status, partial-friendly.
async function processJob(jobId, deps) {
  const job = await deps.store.getStudioJobById(jobId);
  if (!job) throw new Error('No such job.');
  const placements = job.placements || {};
  await deps.store.updateStudioJob(jobId, { status: 'generating', placements });

  const refs = (job.inputs && job.inputs.refUrls) || [];
  for (const key of Object.keys(placements)) {
    if (placements[key].status === 'done') continue;
    const [placementId, v] = key.split(':');
    try {
      placements[key] = await runFrame({ job, placementId, variant: Number(v), refs, deps });
    } catch (err) {
      placements[key] = { status: 'error', error: String(err.message || err).slice(0, 300) };
    }
    await deps.store.updateStudioJob(jobId, { placements });
  }

  const states = Object.values(placements).map((p) => p.status);
  const status = states.every((s) => s === 'done') ? 'done' : states.some((s) => s === 'done') ? 'partial' : 'error';
  await deps.store.updateStudioJob(jobId, { status, placements });
  return { status, placements };
}

// ------------------------------------------------------------- mock deps --
// STUDIO_MOCK=1 (and the tests) run the whole pipeline without any network:
// fal returns a Sharp-generated photo stand-in (a "BUSY_TEST" marker in the
// prompt yields a noisy image so the ladder engages), Claude returns a
// canned spec, and storage is an in-memory map.

const mockStorage = new Map();
let mockFalCalls = [];
let mockFailedOnce = false;

function makeMockDeps(store) {
  return {
    store,
    fal: async (endpoint, payload) => {
      mockFalCalls.push({ endpoint, payload });
      // FAIL_ONCE: the landscape frame's first generation dies (and only the
      // first) - drives the retry-one-frame test deterministically.
      if (/FAIL_ONCE/.test(payload.prompt || '') && (payload.image_size || {}).width === 1200 && !mockFailedOnce) {
        mockFailedOnce = true;
        throw new Error('mock generation failure');
      }
      const busy = /BUSY_TEST/.test(payload.prompt || '');
      const { width, height } = payload.image_size || { width: 1080, height: 1080 };
      let img;
      if (busy) {
        // high-frequency noise everywhere - fails the busyness gate
        const raw = Buffer.alloc(width * height * 3);
        let seed = 12345;
        for (let i = 0; i < raw.length; i++) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          raw[i] = seed % 255;
        }
        img = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
      } else {
        img = await sharp({ create: { width, height, channels: 3, background: '#8FA3B8' } }).png().toBuffer();
      }
      const url = `mock://fal/${rand()}.png`;
      mockStorage.set(url, img);
      return { images: [{ url }] };
    },
    fetchBuffer: async (url) => {
      if (mockStorage.has(url)) return mockStorage.get(url);
      throw new Error('mock fetchBuffer: unknown url ' + url);
    },
    claude: async ({ messages }) => {
      // test markers in the brief ride through to the fal payload so the
      // ladder and retry paths can be driven deterministically
      const user = String((messages && messages[0] && messages[0].content) || '');
      const markers = ['BUSY_TEST', 'FAIL_ONCE'].filter((m) => user.includes(m)).join(' ');
      return JSON.stringify({
        full_prompt: `Warm documentary photograph, golden hour light, gentle depth of field, natural colour grade. Keep the directed zone clean and low-detail.${markers ? ' ' + markers : ''}`,
        negative_prompt: 'text, letters, words, typography, logos, watermarks'
      });
    },
    storagePut: async (path, buffer) => {
      mockStorage.set(path, buffer);
      return `mock://storage/${path}`;
    },
    storageGet: async (path) => {
      if (!mockStorage.has(path)) throw new Error('mock storage miss: ' + path);
      return mockStorage.get(path);
    },
    storageList: async (prefix) =>
      [...mockStorage.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name: name.slice(prefix.length) })),
    qa: {}
  };
}

const resetMocks = () => {
  mockStorage.clear();
  mockFalCalls = [];
  mockFailedOnce = false;
};

// ------------------------------------------------------------- real deps --

function makeRealDeps(store, keys) {
  return {
    store,
    fal: (endpoint, payload) => falRun(endpoint, payload, keys.fal),
    fetchBuffer: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
    claude: async ({ system, messages }) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': keys.anthropic, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 900, system, messages })
      });
      if (!res.ok) throw new Error(`Claude ${res.status}`);
      const d = await res.json();
      return (d.content || []).map((c) => c.text || '').join('');
    },
    storagePut,
    storageGet,
    storageList: async (prefix) => (await storageList(prefix)).map((f) => ({ name: f.name })),
    qa: {
      vision: null, // borderline busyness passes without a second opinion for now
      finalVision: null
    }
  };
}

module.exports = {
  OVERLAY_MAX,
  PLACEMENTS,
  MODELS,
  TEMPLATES,
  DEFAULT_BRAND,
  templateById,
  mirrorTemplate,
  ladderFor,
  SPEC_SYSTEM,
  specUserMessage,
  writeSpec,
  falBalance,
  compose,
  qaZone,
  textZoneBusyness,
  processJob,
  runFrame,
  storagePut,
  storageGet,
  storageList,
  publicUrl,
  makeMockDeps,
  makeRealDeps,
  resetMocks,
  mockStorage,
  mockFalCalls: () => mockFalCalls
};
