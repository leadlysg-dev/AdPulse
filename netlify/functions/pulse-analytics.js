// AI-directed analytics for the Pulse tab. Claude reviews the workspace's
// data for the selected range and decides which 2-4 visuals best explain
// the state of the lead system, returning structured JSON only. Responses
// are validated against a strict per-chart schema; anything invalid is
// dropped, and an empty result tells the client to render its local
// fallback (funnel + trend built from real data) so the section never
// renders empty. Cached per user per day per range; refresh=1 regenerates.
const fetch = require('node-fetch');
const { getEmailFromRequest, getStudioRecord, putStudioRecord } = require('./_store');
const { parseJson } = require('./_studio');

const MODEL = 'claude-haiku-4-5';
const MOCK = process.env.STUDIO_MOCK === '1';

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const SYSTEM = `You are an experienced marketing analyst and teacher for a non-technical business owner. Review the data and decide which 2-4 visuals best explain the current state of their lead system right now. Choose only visuals that reveal something worth knowing today.

Available chart types and their exact data schemas:
- "funnel": data = { "stages": [{ "label": "...", "value": <number> }, ...] }  (2-5 stages, top to bottom of the lead flow)
- "trend": data = { "labels": ["...", ...], "series": [{ "label": "...", "values": [<numbers>] }] }  (1-2 series, same length as labels)
- "bars": data = { "groups": [{ "label": "...", "values": [<numbers>] }], "series": ["name-of-value-1", "name-of-value-2"] }  (compare campaigns or platforms)
- "donut": data = { "slices": [{ "label": "...", "value": <number> }] }  (2-6 slices, how something splits)
- "callout": data = { "value": "<the one number, formatted with currency/units>", "label": "plain-English what it is", "detail": "one short supporting line" }

Rules:
- Titles are plain English a business owner instantly gets, e.g. "Where your enquiries drop off".
- Each visual carries "insight": ONE jargon-free sentence a non-technical reader understands. Say "enquiries", never "leads/conversions/CPL".
- Use ONLY numbers computed from the data provided. Never invent figures.
- Return ONLY JSON, no markdown fences:
{"charts":[{"chart_type":"funnel","title":"...","data":{...},"insight":"..."}]}`;

// strict validation: a chart that doesn't match its schema is dropped
function validate(charts) {
  if (!Array.isArray(charts)) return [];
  const num = (v) => typeof v === 'number' && isFinite(v);
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  return charts
    .filter((c) => {
      if (!c || !str(c.title) || !str(c.insight) || !c.data) return false;
      const d = c.data;
      switch (c.chart_type) {
        case 'funnel':
          return Array.isArray(d.stages) && d.stages.length >= 2 && d.stages.length <= 5 &&
            d.stages.every((s) => str(s.label) && num(s.value));
        case 'trend':
          return Array.isArray(d.labels) && d.labels.length >= 2 && Array.isArray(d.series) &&
            d.series.length >= 1 && d.series.length <= 2 &&
            d.series.every((s) => str(s.label) && Array.isArray(s.values) && s.values.length === d.labels.length && s.values.every(num));
        case 'bars':
          return Array.isArray(d.groups) && d.groups.length >= 1 && Array.isArray(d.series) && d.series.length >= 1 &&
            d.groups.every((g) => str(g.label) && Array.isArray(g.values) && g.values.length === d.series.length && g.values.every(num));
        case 'donut':
          return Array.isArray(d.slices) && d.slices.length >= 2 && d.slices.length <= 6 &&
            d.slices.every((s) => str(s.label) && num(s.value) && s.value >= 0);
        case 'callout':
          return str(d.value) && str(d.label);
        default:
          return false;
      }
    })
    .slice(0, 4);
}

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

  const rangeKey = String(body.rangeKey || 'last_7d').slice(0, 40);
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // SGT day
  const cacheId = `${today}:${rangeKey}`;

  if (!body.refresh) {
    try {
      const cached = await getStudioRecord(email, 'analytics', cacheId);
      if (cached && cached.charts && cached.charts.length) return json(200, { charts: cached.charts, cached: true });
    } catch {
      // cache unavailable - generate fresh
    }
  }

  if (MOCK || !process.env.ANTHROPIC_API_KEY) {
    // the client renders its local fallback (built from real data)
    return json(200, { charts: [] });
  }

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
        max_tokens: 1600,
        system: SYSTEM,
        messages: [{ role: 'user', content: `THE WORKSPACE'S DATA FOR THE SELECTED RANGE:\n${JSON.stringify(body.context || {}).slice(0, 16000)}` }]
      })
    });
    if (!r.ok) throw new Error(`Claude ${r.status}`);
    const d = await r.json();
    const out = parseJson((d.content || []).map((c) => c.text || '').join(''));
    const charts = validate(out.charts);
    if (charts.length) {
      try {
        await putStudioRecord(email, 'analytics', cacheId, { charts, created: Date.now() });
      } catch {
        // caching is best-effort
      }
    }
    return json(200, { charts });
  } catch (err) {
    console.error(`[pulse-analytics] ${err.message}`);
    return json(200, { charts: [] }); // client falls back, section never empty
  }
};
