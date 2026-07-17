// The Pulse AI bar's brain. Exactly three jobs — answering questions about
// the user's ad data, creating/editing ad alerts, and explaining the charts
// and metrics on screen - anything else is politely declined. The current
// dashboard data rides in from the client so answers cite real numbers.
//
// Replies are for non-technical business owners: "enquiries", never
// "leads/conversions/CPL"; plain-cause explanations ("the same people keep
// seeing this ad"). The tone examples in the system prompt are the spec's
// own gen-object answers.
const fetch = require('node-fetch');
const { getEmailFromRequest, getWorkspaceFromRequest } = require('./_store');
const { parseJson } = require('./_json');

const MODEL = 'claude-haiku-4-5';
const MOCK = process.env.STUDIO_MOCK === '1';

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
    actions: [
      { label: 'Show me that ad', kind: 'admanager' },
      { label: 'Freshen it up in Studio', kind: 'studio' }
    ]
  },
  cpl: {
    reply:
      'Right now each new enquiry costs you **S$34.94** on average. Last week it was S$31.20. One ad is behind the jump — **“Retirement Gap”**. People have seen it too many times, so fewer are clicking and each click costs more. Your other ads are fine.',
    actions: [
      { label: 'Show me that ad', kind: 'admanager' },
      { label: 'Make a fresh version', kind: 'studio' }
    ]
  },
  best: {
    reply:
      'Your best performer is **“Insurance — Exact Match”** on Google. Each enquiry from it costs just **S$22.35** — about a third cheaper than the rest — and it could bring in more if it had more budget. Want me to show you what moving S$50 a day into it would do?',
    actions: [
      { label: 'Yes, show me', kind: 'admanager' },
      { label: 'See all ads ranked', kind: 'admanager' }
    ]
  },
  alert: {
    reply:
      'Here’s what I’d watch for you: **if any enquiry starts costing more than S$45, I’ll message you straight away.** That would have caught your tired ad 3 times this month before it wasted money. Shall I switch it on?',
    actions: [{ label: 'Yes, switch it on', kind: 'create_alert' }],
    alert: { metric: 'cpa', channel: 'all', comparison: 'above', threshold: 45, timeframe: 'day', description: 'An enquiry starts costing more than S$45 in a day' }
  }
};

const SYSTEM = (role) => `You are Pulse, the assistant inside Leadly Pulse, a dashboard that shows a business owner how their Facebook (Meta) and Google ads are doing. You have EXACTLY three jobs:
1. Answer questions about the user's ad data (which is provided to you as JSON).
2. Create or edit ad alerts ("warn me if...").
3. Explain the charts and metrics on their screen.
If asked anything outside those three jobs — coding, news, general knowledge, other products, anything at all — politely decline in one friendly sentence and steer back to their ads.

HOW TO SPEAK — this matters as much as being right:
- The reader runs a small business and hates jargon. Say "enquiries", never "leads", "conversions" or "CPL". Say "each enquiry costs you S$34.94", never "CPA of $34.94".
- Explain causes in plain terms: "the same people keep seeing this ad, so it's costing more" — not "frequency fatigue" or "audience saturation".
- Cite the real numbers from the data you're given, in the currency shown (S$). Never invent numbers. If the data doesn't answer the question, say so plainly.
- Keep it to 2-4 sentences. Mark the key numbers and names with **double asterisks**.
- Tone examples of exactly the right register:
  "A good day. You spent **S$642** and got **19 new enquiries** — that's about **S$34 each**, a little cheaper than usual."
  "People have seen it too many times, so fewer are clicking and each click costs more. Your other ads are fine."

ACTIONS — after the reply, offer at most 2 follow-up buttons, choosing kinds from:
- "admanager": open the Campaigns tab (for seeing/changing campaigns)
- "studio": open Studio (for making fresh ad creative)
- "create_alert": switch on the alert you just proposed (ONLY when you propose one; also fill the "alert" object)
${role === 'client' ? '- "change_request": the user is a CLIENT whose ads are managed by Leadly. They cannot change budgets or pause ads themselves. When they ask for ANY change to their ads, propose sending the request to Leadly with this action (fill "request" with a one-line summary), and never suggest they can edit it themselves.' : ''}

ALERTS — when the user wants to be warned about something, propose ONE alert in plain English in the reply, add a "create_alert" action labelled like "Yes, switch it on", and fill "alert" with: metric (one of cpa|roas|spend|ctr|conversions), channel (meta|google|all), comparison (above|below), threshold (number), timeframe (day|week|month), description (plain-English, e.g. "An enquiry starts costing more than S$45 in a day").

Return ONLY JSON, no markdown fences:
{"reply":"...","actions":[{"label":"...","kind":"...","request":"only for change_request"}],"alert":{...only when proposing one}}`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed.' };
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request.' });
  }
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

  let role = 'owner';
  try {
    role = (await getWorkspaceFromRequest(event.headers, email)).role;
  } catch {
    // membership tables not migrated yet - treat as owner
  }

  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const content = `THE USER'S DASHBOARD RIGHT NOW (their real numbers):\n${JSON.stringify(context).slice(0, 14000)}\n\nTHE USER ASKS: ${message}`;

  try {
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
        system: SYSTEM(role),
        messages: [{ role: 'user', content }]
      })
    });
    if (!r.ok) throw new Error(`Claude ${r.status}`);
    const d = await r.json();
    const text = (d.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const out = parseJson(text);
    const actions = Array.isArray(out.actions)
      ? out.actions
          .filter((a) => a && ['admanager', 'studio', 'create_alert', 'change_request'].includes(a.kind))
          .slice(0, 2)
      : [];
    return json(200, { reply: String(out.reply || text).slice(0, 2000), actions, alert: out.alert || null });
  } catch (err) {
    console.error(`[pulse-chat] ${err.message}`);
    return json(200, { reply: 'I couldn’t finish that thought — press the question again in a moment.', actions: [] });
  }
};
