// Animate a finished still. Kling takes its aspect ratio from the image,
// which is how 1:1 and 4:5 video ads happen - Veo can't make them.
// Returns a motion id; the browser polls studio-motion until it's done.
const { getEmailFromRequest, putStudioRecord } = require('./_store');
const { MODELS, MOCK, falSubmit, stamp, json } = require('./_studio');

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
  const { src, prompt = '', model = 'kling-3-pro', duration = 5, audio = false } = b;
  if (!src) return json(200, { error: 'Pick an image.' });
  if (!MODELS[model] || MODELS[model].kind !== 'animate') return json(200, { error: 'Unknown animate model.' });

  try {
    const rec = {
      id: `motion--${stamp()}`,
      state: 'generating',
      src,
      prompt: prompt || 'Subtle natural cinematic motion. Hold the composition.',
      model,
      duration: +duration || 5,
      audio: !!audio,
      created: Date.now()
    };
    if (MOCK) {
      rec.pending = { mock: true };
    } else {
      const input = MODELS[model].input(rec.prompt, { image_url: src, duration: rec.duration, audio: rec.audio });
      rec.pending = await falSubmit(MODELS[model].endpoints[0], input);
    }
    await putStudioRecord(email, 'motion', rec.id, rec);
    return json(200, { motionId: rec.id });
  } catch (err) {
    console.error(`[studio-animate] ${err.message}`);
    return json(200, { error: err.message });
  }
};
