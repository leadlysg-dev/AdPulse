// The editor's prompt writer: Claude looks at the image being edited and
// rewrites a rough wish into a precise instruction that pins down what to
// leave untouched - the part that stops the model wrecking the image.
const { getEmailFromRequest } = require('./_store');
const { HAS_CLAUDE, MODEL_NOTES, callClaude, parseJson, imageBlock, json } = require('./_studio');

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

  if (!HAS_CLAUDE) return json(200, { degraded: true, error: 'No ANTHROPIC_API_KEY configured.' });
  if (!b.instruction) return json(200, { error: 'Say roughly what you want changed.' });

  const content = [{ type: 'text', text: 'LOOK AT THIS IMAGE. I want to edit it.' }];
  const srcBlock = imageBlock(b.src);
  if (!srcBlock) return json(200, { error: "Can't read that source image." });
  content.push(srcBlock);
  for (const r of (b.refs || []).slice(0, 6)) {
    const block = imageBlock(r);
    if (block) content.push(block);
  }
  content.push({
    type: 'text',
    text: `WHAT I ROUGHLY WANT: ${b.instruction}

RENDERER: nano-banana-edit
${MODEL_NOTES['nano-banana-edit']}

Rewrite this as a precise edit instruction. It MUST state, in this order:
1. exactly what to CHANGE
2. exactly what to LEAVE UNTOUCHED — the composition, the subject, the framing, the crop, the light, and everything else you can see that is not being changed. Be concrete about what is actually in the image. This is the part that stops the model wrecking it.

Return JSON only:
{ "prompt": "the edit instruction", "negative": "what must not appear", "placement_notes": {}, "reasoning": "one line" }`
  });

  try {
    const { text, usage, cost } = await callClaude(content, 1600, !!b.textMode);
    const out = parseJson(text);
    return json(200, { instruction: out.prompt, negative: out.negative || '', reasoning: out.reasoning || '', usage, cost });
  } catch (e) {
    return json(200, { error: String((e && e.message) || e) });
  }
};
