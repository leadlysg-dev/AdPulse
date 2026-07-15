// The Library: everything this user has made or uploaded, newest first -
// job renders, edit-chain steps, animate clips, and uploaded references.
// Media is fal-hosted URLs (or data URIs in mock mode); this just lists.
const { getEmailFromRequest, listStudioRecords } = require('./_store');
const { json } = require('./_studio');

exports.handler = async (event) => {
  const email = getEmailFromRequest(event.headers);
  if (!email) return { statusCode: 401, body: 'Not logged in.' };
  try {
    const [jobs, chains, motions, uploads] = await Promise.all([
      listStudioRecords(email, 'job', { limit: 40 }),
      listStudioRecords(email, 'chain', { limit: 20 }),
      listStudioRecords(email, 'motion', { limit: 20 }),
      listStudioRecords(email, 'upload', { limit: 60 })
    ]);

    const items = [];
    for (const job of jobs) {
      for (const [pid, item] of Object.entries(job.items || {})) {
        let img = 0;
        let vid = 0;
        for (const f of item.files || []) {
          const variant = f.video ? ++vid : ++img;
          items.push({
            url: f.url,
            video: !!f.video,
            project: job.project,
            job: job.id,
            placement: pid,
            variant,
            name: `${pid}-v${variant}.${f.video ? 'mp4' : 'png'}`,
            mtime: job.updated || job.created
          });
        }
      }
    }
    for (const chain of chains) {
      (chain.steps || []).forEach((s, i) => {
        (s.results || []).forEach((url, k) => {
          items.push({
            url,
            video: false,
            project: 'edits',
            job: chain.id,
            placement: null,
            variant: null,
            name: `step${i + 1}${s.results.length > 1 ? '.' + (k + 1) : ''}.png`,
            mtime: s.at || chain.created
          });
        });
      });
    }
    for (const m of motions) {
      if (m.url)
        items.push({
          url: m.url,
          video: true,
          project: 'motion',
          job: m.id,
          placement: null,
          variant: null,
          name: 'motion.mp4',
          mtime: m.created
        });
    }
    for (const u of uploads) {
      items.push({
        url: u.url,
        video: false,
        project: 'uploaded',
        job: null,
        placement: null,
        variant: null,
        name: u.name,
        mtime: u.created
      });
    }

    items.sort((a, b) => b.mtime - a.mtime);
    return json(200, { items: items.slice(0, 500) });
  } catch (err) {
    console.error(`[studio-library] ${err.message}`);
    return json(200, { items: [], unavailable: true });
  }
};
