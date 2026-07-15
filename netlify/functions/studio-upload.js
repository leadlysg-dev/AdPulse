// Uploads, three kinds by target:
//   image - reference images. Pushed to fal storage (models need a plain
//           https URL); in mock mode the data URI is kept as-is.
//   brand - a markdown file of permanent rules; lands in the brand picker.
//   file  - briefs/specs (.md .txt .csv .json .pdf) stored as plain text
//           and fed to the prompt writer.
// Function request bodies cap out around 6 MB, so oversized files are
// reported back as skipped rather than failing the whole batch.
const { getEmailFromRequest, putStudioRecord } = require('./_store');
const { MOCK, falUpload, slug, json } = require('./_studio');

const MAX_BYTES = 5 * 1024 * 1024;

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

  const files = b.files || [];
  const target = b.target || 'image';
  const saved = [];
  const docs = [];
  const brands = [];
  const skipped = [];

  const bytes = (raw) => {
    const m = /^data:[^;]*;base64,(.+)$/i.exec(raw);
    return m
      ? Buffer.from(m[1], 'base64')
      : Buffer.from(decodeURIComponent(String(raw).replace(/^data:[^,]*,/, '')), 'utf8');
  };

  try {
    for (const f of files) {
      const raw = f.data || '';
      const nm = f.name || 'file';

      if (target === 'image') {
        const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(raw);
        if (!m) {
          skipped.push(nm);
          continue;
        }
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_BYTES) {
          skipped.push(nm + ' (over 5 MB — resize it first)');
          continue;
        }
        const id = `${Date.now()}-${slug(nm).slice(0, 32)}`;
        const url = MOCK ? raw : await falUpload(buf, `${id}.${m[1].split('/')[1] || 'png'}`, m[1]);
        await putStudioRecord(email, 'upload', id, { url, name: nm, created: Date.now() });
        saved.push({ url, name: nm });
        continue;
      }

      if (target === 'brand') {
        const name = slug(nm.replace(/\.[^.]+$/, '')) + '.md';
        await putStudioRecord(email, 'brand', name, { name, text: bytes(raw).toString('utf8'), created: Date.now() });
        brands.push(name);
        continue;
      }

      const buf = bytes(raw);
      if (buf.length > MAX_BYTES) {
        skipped.push(nm + ' (over 5 MB)');
        continue;
      }
      let text = '';
      if (/\.pdf$/i.test(nm)) {
        try {
          const pdf = require('pdf-parse');
          text = (await pdf(buf)).text;
        } catch {
          skipped.push(nm + ' (PDF unreadable — save it as .md or .txt)');
          continue;
        }
      } else if (/\.(md|markdown|txt|csv|json|html?)$/i.test(nm)) {
        text = buf.toString('utf8');
      } else {
        skipped.push(nm + ' (only .md .txt .csv .json .pdf)');
        continue;
      }
      text = text.replace(/\s+\n/g, '\n').trim();
      if (!text) {
        skipped.push(nm + ' (no readable text)');
        continue;
      }
      const name = slug(nm.replace(/\.[^.]+$/, '')) + '.txt';
      await putStudioRecord(email, 'doc', name, { name, text, chars: text.length, from: nm, created: Date.now() });
      docs.push({ name, chars: text.length, from: nm });
    }
    return json(200, { saved, docs, brands, skipped });
  } catch (err) {
    console.error(`[studio-upload] ${err.message}`);
    return json(200, { error: err.message });
  }
};
