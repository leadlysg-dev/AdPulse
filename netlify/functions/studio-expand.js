// The prompt studio: Claude turns a rough line into a production prompt,
// an expanded keep-out list, and per-placement composition notes - shown
// for review before anything is generated or paid for.
const { getEmailFromRequest, getStudioRecord } = require('./_store');
const {
  HAS_CLAUDE,
  MODELS,
  MODEL_NOTES,
  PLACEMENTS,
  UNSAFE,
  callClaude,
  parseJson,
  imageBlock,
  json
} = require('./_studio');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  let b;
  try {
    b = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  if (!HAS_CLAUDE)
    return json(200, {
      degraded: true,
      error:
        'No ANTHROPIC_API_KEY configured, so the prompt writer is off. Everything else works — your raw prompt will be used exactly as written.'
    });
  if (!b.prompt) return json(200, { error: 'Write a rough prompt first. One line is enough.' });

  const target =
    b.refs && b.refs.length && MODELS[b.model] && MODELS[b.model].kind !== 'video'
      ? b.textMode
        ? 'gpt-image-2-edit'
        : 'nano-banana-edit'
      : b.model;
  const places = (b.placements || []).map((id) => PLACEMENTS.find((p) => p.id === id)).filter(Boolean);

  const lines = [];
  lines.push(`MY ROUGH PROMPT:\n${b.prompt}`);
  if (b.textMode) {
    lines.push(
      `TEXT MODE IS ON. RENDER THIS COPY INTO THE IMAGE, VERBATIM — every word, spelled exactly:\n\n${b.copy || '(none supplied — ask for it in your reasoning)'}\n\nUse ONLY these words. Add no copy of your own. Specify the typography, the hierarchy and where the block sits, in every placement.`
    );
  }
  lines.push(`RENDERER: ${target}\n${MODEL_NOTES[target] || ''}`);
  lines.push(
    'PLACEMENTS — write a placement_notes entry keyed by each id:\n' +
      places
        .map((p) => {
          const u = UNSAFE[p.id];
          return (
            `- ${p.id} · ${p.label} · ${p.ratio} · ${p.w}x${p.h}px\n  ` +
            (u
              ? `UNSAFE: the top ${u.top}% and bottom ${u.bottom}% are covered by ${u.why}. Nothing important may sit there.`
              : 'UNSAFE: none. The whole frame is usable.')
          );
        })
        .join('\n')
  );
  if (b.negative) lines.push(`KEEP OUT (expand this with this model's known habits):\n${b.negative}`);

  try {
    const bits = [];
    for (const name of b.docs || []) {
      const doc = await getStudioRecord(email, 'doc', name);
      if (doc && doc.text) bits.push(`--- ${name} ---\n` + doc.text.slice(0, 6000).trim());
    }
    if (bits.length) lines.push('THE BRIEF:\n\n' + bits.join('\n\n'));
    if (b.brand) {
      const brand = await getStudioRecord(email, 'brand', b.brand);
      if (brand && brand.text) lines.push('BRAND GUIDELINES — these outrank your taste:\n\n' + brand.text.trim());
    }
  } catch (err) {
    console.error(`[studio-expand] docs unavailable: ${err.message}`);
  }

  const content = [];
  if (b.refs && b.refs.length) {
    content.push({
      type: 'text',
      text: `${b.refs.length} reference image(s) attached. LOOK AT THEM. This is an EDIT/BLEND, not generation from nothing. Your prompt must be an instruction relative to these images and must say what to LEAVE UNTOUCHED.`
    });
    for (const r of b.refs.slice(0, 8)) {
      const block = imageBlock(r);
      if (block) content.push(block);
    }
  }
  content.push({ type: 'text', text: lines.join('\n\n') });

  // one retry: a bad parse is nearly always a one-off
  let lastErr;
  let spent = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text, usage, cost } = await callClaude(content, 4096, !!b.textMode);
      spent += cost;
      const out = parseJson(text);
      return json(200, {
        prompt: out.prompt || b.prompt,
        negative: out.negative != null ? out.negative : b.negative || '',
        placement_notes: out.placement_notes || {},
        reasoning: out.reasoning || '',
        usage,
        cost: spent
      });
    } catch (e) {
      lastErr = e;
    }
  }
  return json(200, { error: String((lastErr && lastErr.message) || lastErr) });
};
