// The Pulse bar's four suggested questions, regenerated from that day's ad
// data (cached per user per day - the first visit of the morning generates
// them). Same reading level as the defaults; each carries one of the four
// spec colour classes. Any failure falls back to the four spec defaults.
const fetch = require('node-fetch');
const { getEmailFromRequest, getUser, getStudioRecord, putStudioRecord, getWorkspaceFromRequest, getMetricsConfig } = require('./_store');
const { parseJson } = require('./_json');

const MODEL = 'claude-haiku-4-5';
const MOCK = process.env.STUDIO_MOCK === '1';
const COLORS = ['c-green', 'c-cobalt', 'c-purple', 'c-amber'];

const DEFAULTS = [
  { key: 'today', color: 'c-green', label: 'How did my ads do today?' },
  { key: 'cpl', color: 'c-cobalt', label: 'What’s my cost per lead?' },
  { key: 'best', color: 'c-purple', label: 'Which ad is doing best?' },
  { key: 'alert', color: 'c-amber', label: 'Warn me if something goes wrong' }
];

const json = (body) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  if (MOCK || !process.env.ANTHROPIC_API_KEY) return json({ chips: DEFAULTS });

  // The client's word for their headline result flavours the questions, and
  // re-running the metrics setup invalidates the day's cache.
  let resultName = 'enquiries';
  try {
    const workspace = await getWorkspaceFromRequest(event.headers, email);
    const config = workspace.id ? await getMetricsConfig(workspace.id) : null;
    if (config && config.primaryResult && config.primaryResult.name) resultName = config.primaryResult.name.toLowerCase();
  } catch {
    // config unavailable - default word
  }

  // Singapore morning: the cache key is today's date in SGT + the result name
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const cacheId = `${today}-${resultName.replace(/[^a-z0-9]+/g, '_')}`;
  try {
    const cached = await getStudioRecord(email, 'pulse-chips', cacheId);
    if (cached && Array.isArray(cached.chips) && cached.chips.length === 4) return json({ chips: cached.chips });
  } catch {
    // storage hiccup - fall through to defaults
  }

  try {
    const { buildSnapshot } = require('./_aiData');
    const user = await getUser(email);
    const snapshot = await buildSnapshot(user, 'last_7d');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: `You write four short suggested questions for a small-business owner's ad dashboard, based on today's data. Same reading level as these examples: "How did my ads do today?", "Which ad is doing best?", "Warn me if something goes wrong". No jargon - this client calls their results "${resultName}", so use that word, never "leads/conversions". Each question under 8 words. Make them specific to anything interesting in the data (a rising cost, a winning ad, an idle campaign). The LAST one must always be about setting up a warning/alert. Return ONLY JSON: {"chips":[{"label":"..."},{"label":"..."},{"label":"..."},{"label":"..."}]}`,
        messages: [{ role: 'user', content: `TODAY'S DATA:\n${JSON.stringify(snapshot).slice(0, 10000)}` }]
      })
    });
    if (!r.ok) throw new Error(`Claude ${r.status}`);
    const d = await r.json();
    const out = parseJson((d.content || []).map((c) => c.text || '').join(''));
    const labels = (out.chips || []).map((c) => String(c.label || '').trim()).filter(Boolean);
    if (labels.length !== 4) throw new Error('bad chip count');
    const chips = labels.map((label, i) => ({
      key: i === 3 ? 'alert' : null,
      color: COLORS[i],
      label
    }));
    await putStudioRecord(email, 'pulse-chips', cacheId, { chips, created: Date.now() });
    return json({ chips });
  } catch (err) {
    console.error(`[pulse-chips] ${err.message}`);
    return json({ chips: DEFAULTS });
  }
};
