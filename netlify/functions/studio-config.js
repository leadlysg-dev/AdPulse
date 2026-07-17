// Everything the Studio tab needs to render: unlock state, budget +
// month spend, templates, placements, models with prices, brand kit, and
// the overlay character cap. Clients get the credits bar as fractions
// only; owners/agency/admin see dollar figures.
const { getEmailFromRequest, getWorkspaceFromRequest, getWorkspaceStudio, getMonthSpend } = require('./_store');
const { TEMPLATES, PLACEMENTS, MODELS, OVERLAY_MAX, DEFAULT_BRAND } = require('./_studioCore');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return json(401, { error: 'Not logged in.' });
  try {
    const workspace = await getWorkspaceFromRequest(event.headers, email);
    if (!workspace.id) return json(200, { enabled: false });
    const studio = await getWorkspaceStudio(workspace.id);
    const monthSpend = studio.enabled ? await getMonthSpend(workspace.id).catch(() => 0) : 0;
    const isClient = workspace.role === 'client' || workspace.role === 'member';
    const remaining = +Math.max(0, studio.budget - monthSpend).toFixed(2);
    return json(200, {
      enabled: studio.enabled,
      role: workspace.role,
      overlayMax: OVERLAY_MAX,
      brandKit: studio.brandKit || DEFAULT_BRAND,
      credits: isClient
        ? { usedFrac: studio.budget > 0 ? Math.min(1, monthSpend / studio.budget) : 0, exhausted: remaining <= 0 }
        : { budget: studio.budget, monthSpend, remaining, exhausted: remaining <= 0 },
      templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, kind: t.kind, zone: t.zone, imageRect: t.imageRect || null, logoCorner: t.logoCorner || null })),
      placements: Object.values(PLACEMENTS).map((p) => ({ id: p.id, label: p.label, w: p.w, h: p.h, ratio: p.ratio })),
      models: Object.values(MODELS).map((m) => ({ id: m.id, label: m.label, price: m.price }))
    });
  } catch (err) {
    console.error(`[studio-config] ${err.message}`);
    return json(400, { error: err.message });
  }
};
