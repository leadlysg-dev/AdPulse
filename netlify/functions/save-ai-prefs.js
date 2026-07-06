// Persists the Settings page's AI preferences on the user's record. The
// preferences only save for now - the AI features that read them come in a
// later step. The whole object is rebuilt from the request field by field,
// so nothing unexpected can be smuggled into storage.
const { getEmailFromRequest, saveAiPrefs } = require('./_store');

const MAX_TEXT = 2000;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function sanitize(body) {
  const b = body && typeof body === 'object' ? body : {};
  const insights = b.insights && typeof b.insights === 'object' ? b.insights : {};
  const assistant = b.assistant && typeof b.assistant === 'object' ? b.assistant : {};
  return {
    enabled: !!b.enabled,
    insights: {
      enabled: !!insights.enabled,
      cadence: insights.cadence === 'daily' ? 'daily' : 'weekly',
      prompt: String(insights.prompt || '').slice(0, MAX_TEXT)
    },
    assistant: {
      enabled: !!assistant.enabled,
      instructions: String(assistant.instructions || '').slice(0, MAX_TEXT)
    }
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });

  let parsed;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  const prefs = sanitize(parsed);
  await saveAiPrefs(email, prefs);
  return json(200, { ok: true, aiPrefs: prefs });
};
