// Everything the Studio UI builds itself from: placements, unsafe zones,
// the model registry, this user's brand files, and whether the prompt
// writer (Claude) is available.
const { getEmailFromRequest, listStudioRecords } = require('./_store');
const { PLACEMENTS, UNSAFE, byKind, CLAUDE, HAS_CLAUDE, MOCK, json } = require('./_studio');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  let brands = [];
  try {
    brands = (await listStudioRecords(email, 'brand', { limit: 50 })).map((b) => b.name);
  } catch (err) {
    console.error(`[studio-init] brands unavailable: ${err.message}`);
  }
  return json(200, {
    placements: PLACEMENTS,
    unsafe: UNSAFE,
    models: { image: byKind('image'), edit: byKind('edit'), video: byKind('video'), animate: byKind('animate') },
    brands,
    claude: HAS_CLAUDE,
    claudeModel: CLAUDE.model,
    mock: MOCK,
    falConfigured: MOCK || !!process.env.FAL_KEY
  });
};
