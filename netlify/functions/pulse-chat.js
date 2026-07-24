// The Pulse AI bar's brain. Exactly two jobs — answering questions about
// the user's ad data and explaining the charts and metrics on screen -
// anything else is politely declined. The current dashboard data rides in
// from the client so answers cite real numbers.
//
// Replies are for non-technical business owners: "enquiries", never
// "leads/conversions/CPL"; plain-cause explanations ("the same people keep
// seeing this ad"). The tone examples in the system prompt are the spec's
// own gen-object answers.
const fetch = require('node-fetch');
const { getEmailFromRequest } = require('./_store');
const { parseJson } = require('./_json');

const MODEL = 'claude-haiku-4-5';
const MOCK = process.env.AI_MOCK === '1';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

// Spec tone examples, reused verbatim as the mock answers (**bold** form).
const MOCK_ANSWERS = {
  today: {
    reply:
      'A good day. You spent **S$642** and got **19 new enquiries** — that’s about **S$34 each**, a little cheaper than usual. Google brought in the most (8 enquiries). One thing to watch: your “Retirement Gap” ad is getting tired — the same people keep seeing it, so it’s costing more.',
    actions: [{ label: 'Show me that ad', kind: 'admanager' }]
  },
  cpl: {
    reply:
      'Right now each new enquiry costs you **S$34.94** on average. Last week it was S$31.20. One ad is behind the jump — **“Retirement Gap”**. People have seen it too many times, so fewer are clicking and each click costs more. Your other ads are fine.',
    actions: [{ label: 'Show me that ad', kind: 'admanager' }]
  },
  best: {
    reply:
      'Your best performer is **“Insurance — Exact Match”** on Google. Each enquiry from it costs just **S$22.35** — about a third cheaper than the rest — and it could bring in more if it had more budget. Want me to show you what moving S$50 a day into it would do?',
    actions: [
      { label: 'Yes, show me', kind: 'admanager' },
      { label: 'See all ads ranked', kind: 'admanager' }
    ]
  }
};

const SYSTEM = () => `You are Pulse, the assistant inside Leadly Pulse, the agency's internal dashboard that shows how a client's Facebook (Meta) and Google ads are doing. You have EXACTLY two jobs:
1. Answer questions about the ad data (which is provided to you as JSON).
2. Explain the charts and metrics on screen.
If asked anything outside those jobs — coding, news, general knowledge, other products, anything at all — politely decline in one friendly sentence and steer back to the ads.

HOW TO SPEAK — this matters as much as being right:
- The reader hates jargon. Say "enquiries", never "leads", "conversions" or "CPL". Say "each enquiry costs you S$34.94", never "CPA of $34.94".
- Explain causes in plain terms: "the same people keep seeing this ad, so it's costing more" — not "frequency fatigue" or "audience saturation".
- Cite the real numbers from the data you're given, in the currency shown (S$). Never invent numbers. If the data doesn't answer the question, say so plainly.
- Keep it to 2-4 sentences. Mark the key numbers and names with **double asterisks**.
- Tone examples of exactly the right register:
  "A good day. You spent **S$642** and got **19 new enquiries** — that's about **S$34 each**, a little cheaper than usual."
  "People have seen it too many times, so fewer are clicking and each click costs more. Your other ads are fine."

ACTIONS — after the reply, offer at most 2 follow-up buttons, choosing kinds from:
- "admanager": open the Campaigns tab (for seeing/changing campaigns)

Return ONLY JSON, no markdown fences:
{"reply":"...","actions":[{"label":"...","kind":"..."}]}`;

async function askClaude(context, message) {
  const content = `THE USER'S DASHBOARD RIGHT NOW (their real numbers):\n${JSON.stringify(context).slice(0, 14000)}\n\nTHE USER ASKS: ${message}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM(),
      messages: [{ role: 'user', content }]
    })
  });
  if (!r.ok) throw new Error(`Claude ${r.status}`);
  const d = await r.json();
  const text = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const out = parseJson(text);
  const actions = Array.isArray(out.actions)
    ? out.actions.filter((a) => a && a.kind === 'admanager').slice(0, 2)
    : [];
  return { reply: String(out.reply || text).slice(0, 2000), actions };
}

// Demo mode: no session, and the client's context is IGNORED - the server
// answers from its own fixture summary, so a crafted request can't feed the
// model someone else's numbers. Replies carry no action buttons (they'd
// navigate into an app the demo visitor doesn't have) and each IP gets a
// per-instance hourly cap so the public endpoint can't be farmed.
const DEMO_LIMIT = 20;
const demoHits = new Map(); // ip -> { ts, count }

async function demoChat(event, body) {
  const message = String(body.message || '').slice(0, 600);
  if (!message.trim()) return json(400, { error: 'Ask something first.' });

  const ip = String(event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'unknown')
    .split(',')[0]
    .trim();
  const now = Date.now();
  if (demoHits.size > 5000) demoHits.clear();
  const hit = demoHits.get(ip);
  if (!hit || now - hit.ts > 3600000) demoHits.set(ip, { ts: now, count: 1 });
  else if (hit.count >= DEMO_LIMIT) return json(429, { error: 'Demo limit reached — try again in a bit.' });
  else hit.count += 1;

  if (MOCK) {
    const m = MOCK_ANSWERS[body.chip] || MOCK_ANSWERS.today;
    return json(200, { reply: m.reply, actions: [] });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(200, { reply: 'The assistant isn’t switched on yet — your numbers below are unaffected.', actions: [] });
  }
  try {
    const out = await askClaude(require('./_demoContext.json'), message);
    return json(200, { reply: out.reply, actions: [] });
  } catch (err) {
    console.error(`[pulse-chat demo] ${err.message}`);
    return json(200, { reply: 'I couldn’t finish that thought — press the question again in a moment.', actions: [] });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  if (body.demo === true) return demoChat(event, body);

  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  const message = String(body.message || '').slice(0, 600);
  if (!message.trim()) return json(400, { error: 'Ask something first.' });

  if (MOCK) {
    return json(200, MOCK_ANSWERS[body.chip] || MOCK_ANSWERS.today);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(200, {
      reply: 'The assistant isn’t switched on yet — your numbers below are unaffected.',
      actions: []
    });
  }

  const context = body.context && typeof body.context === 'object' ? body.context : {};

  try {
    return json(200, await askClaude(context, message));
  } catch (err) {
    console.error(`[pulse-chat] ${err.message}`);
    return json(200, { reply: 'I couldn’t finish that thought — press the question again in a moment.', actions: [] });
  }
};
