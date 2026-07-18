// Generates the demo fixtures for "Northside Dental" - a seeded, fully
// deterministic 90-day daily series per platform, generated FIRST; every
// number the demo shows (totals, CTR/CPC/CPM, conversions, cost-per,
// campaign/ad set/ad rows) is DERIVED from these series at runtime, so
// every card, chart and nested table row reconciles arithmetically.
//
// Run: node scripts/gen-demo-fixtures.mjs   (rewrites src/demo/fixtures/*
// and netlify/functions/_demoContext.json). Committed output is static.
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'src/demo/fixtures';
fs.mkdirSync(OUT, { recursive: true });

// seeded PRNG - identical output every run
let seed = 20260718;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const jitter = (base, spread) => base * (1 + (rand() * 2 - 1) * spread);
const r2 = (v) => Math.round(v * 100) / 100;

const DAYS = 90;
// the demo's "today" is fixed so the data never goes stale-looking relative
// to itself; the UI anchors all ranges to the last fixture date
const END = new Date('2026-07-17T00:00:00Z');
const dates = [];
for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(END.getTime() - i * 86400000);
  dates.push(d.toISOString().slice(0, 10));
}

const MSG = 'onsite_conversion.messaging_conversation_started_7d';
const LEAD = 'lead';
const GCALL = 'customers/8846021573/conversionActions/6413377902'; // Calls from ads
const GFORM = 'customers/8846021573/conversionActions/6413377917'; // Booking form

// One visible trend: a new campaign scales from day 55, lifting spend and
// improving cost-per as it learns. Weekends dip.
function metaDay(i, iso) {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  const weekend = dow === 0 || dow === 6 ? 0.72 : 1;
  const ramp = i >= 55 ? 1 + ((i - 55) / 35) * 0.55 : 1;
  const spend = r2(jitter(62 * weekend * ramp, 0.14));
  const cpm = jitter(9.2, 0.1);
  const impressions = Math.round((spend / cpm) * 1000);
  const ctr = jitter(0.021, 0.12) * (i >= 55 ? 1.08 : 1);
  const clicks = Math.max(1, Math.round(impressions * ctr));
  const reach = Math.round(impressions / jitter(2.3, 0.06));
  const lpv = Math.round(clicks * jitter(0.68, 0.08));
  const video = Math.round(impressions * jitter(0.11, 0.15));
  const engagement = Math.round(impressions * jitter(0.028, 0.15));
  // messaging conversions get CHEAPER after the ramp (the visible win)
  const cplBase = i >= 55 ? 16.5 - ((i - 55) / 35) * 3.4 : 18.2;
  const msg = Math.max(0, Math.round(spend / jitter(cplBase, 0.16)));
  const leads = Math.max(0, Math.round(spend / jitter(41, 0.2)));
  return { date: iso, spend, impressions, clicks, reach, lpv, video, engagement, events: { [MSG]: msg, [LEAD]: leads } };
}

function googleDay(i, iso) {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  const weekend = dow === 0 || dow === 6 ? 0.86 : 1;
  const spend = r2(jitter(38 * weekend, 0.12));
  const cpm = jitter(21, 0.08);
  const impressions = Math.round((spend / cpm) * 1000);
  const ctr = jitter(0.062, 0.1);
  const clicks = Math.max(1, Math.round(impressions * ctr));
  const calls = Math.max(0, Math.round(spend / jitter(21.5, 0.18)));
  const forms = Math.max(0, Math.round(spend / jitter(33, 0.2)));
  return { date: iso, spend, impressions, clicks, events: { [GCALL]: calls, [GFORM]: forms } };
}

const daily = {
  dates,
  meta: dates.map((iso, i) => metaDay(i, iso)),
  google: dates.map((iso, i) => googleDay(i, iso))
};

// Structure weights: campaign -> ad set/ad group -> ad shares of the
// platform series. Shares at each level sum to 1, so every nesting level
// reconciles with its parent by construction. rampOnly campaigns only
// receive weight from day 55 (they carry the visible trend).
const structure = {
  meta: [
    {
      id: 'mc1', name: 'Invisalign — Lead Gen', share: 0.44,
      children: [
        { id: 'mas1', name: 'Lookalike 3% — SG', share: 0.6, children: [
          { id: 'mad1', name: 'Smile transformation UGC', share: 0.55, format: 'video' },
          { id: 'mad2', name: 'Before/after carousel', share: 0.45, format: 'image' }
        ] },
        { id: 'mas2', name: 'Retargeting — site visitors', share: 0.4, children: [
          { id: 'mad3', name: 'Patient testimonial 30s', share: 0.62, format: 'video' },
          { id: 'mad4', name: 'Free consult static', share: 0.38, format: 'image' }
        ] }
      ]
    },
    {
      id: 'mc2', name: 'Kids Dentistry — Messages', share: 0.33,
      children: [
        { id: 'mas3', name: 'Parents 28-45 — 5km radius', share: 1, children: [
          { id: 'mad5', name: 'First visit free check', share: 0.52, format: 'image' },
          { id: 'mad6', name: 'Gentle dentist reel', share: 0.48, format: 'video' }
        ] }
      ]
    },
    {
      id: 'mc3', name: 'Whitening Promo — July', share: 0.23, rampFrom: 55,
      children: [
        { id: 'mas4', name: 'Broad — advantage+', share: 1, children: [
          { id: 'mad7', name: 'Whitening offer story', share: 1, format: 'video' }
        ] }
      ]
    }
  ],
  google: [
    {
      id: 'gc1', name: 'Search — dentist near me', share: 0.58,
      children: [
        { id: 'gg1', name: 'Emergency + near me terms', share: 0.55, children: [
          { id: 'gad1', name: 'RSA — same-day appointments', share: 1, format: 'image' }
        ] },
        { id: 'gg2', name: 'Invisalign terms', share: 0.45, children: [
          { id: 'gad2', name: 'RSA — invisalign pricing', share: 1, format: 'image' }
        ] }
      ]
    },
    {
      id: 'gc2', name: 'Search — kids dentist', share: 0.42,
      children: [
        { id: 'gg3', name: 'Kids + family dentist terms', share: 1, children: [
          { id: 'gad3', name: 'RSA — gentle with kids', share: 1, format: 'image' }
        ] }
      ]
    }
  ]
};

// When enquiries arrive: hour-of-day weights (lunch + evening peaks) and
// day-of-week weights used to spread the mapped events into the heatmap.
const heatProfile = {
  hours: [0, 0, 0, 0, 0, 0, 1, 2, 4, 6, 7, 8, 9, 7, 5, 4, 4, 5, 7, 8, 6, 4, 2, 1],
  dows: [8, 9, 9, 8, 7, 5, 4] // Mon..Sun
};

const client = {
  workspace: { id: 'demo-ws', name: 'Northside Dental', role: 'owner', billingExempt: false, managed: true },
  email: 'demo@leadly.sg',
  accounts: {
    meta: { id: 'act_291045518', name: 'Northside Dental — Meta' },
    google: { id: '8846021573', name: 'Northside Dental — Google Ads' }
  },
  // completed onboarding: defaults + 2 extras + 2 conversion events with
  // cost-per, and the blended primary mapping on both platforms
  metricsConfig: {
    extras: ['reach', 'video_views'],
    conversions: [
      { id: MSG, label: 'Messaging conversations started', platform: 'meta' },
      { id: LEAD, label: 'Leads', platform: 'meta' },
      { id: GCALL, label: 'Calls from ads', platform: 'google' },
      { id: GFORM, label: 'Booking form submits', platform: 'google' }
    ],
    primaryResult: {
      name: 'Enquiries',
      source: 'platform_event',
      meta: { event: MSG, label: 'Messaging conversations started' },
      google: { event: GCALL, label: 'Calls from ads' }
    }
  },
  eventLabels: { [MSG]: 'Messaging conversations started', [LEAD]: 'Leads', [GCALL]: 'Calls from ads', [GFORM]: 'Booking form submits' },
  brandKit: { color: '#0E7C86', ink: '#0E1116', paper: '#FFFFFF', font: 'Figtree, Helvetica, Arial, sans-serif', logoText: 'NORTHSIDE' },
  heatProfile
};

// Studio gallery: SVG placeholders as data URLs (fixture-only art)
const svgAsset = (bg, band, text) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540"><rect width="540" height="540" fill="${bg}"/><rect y="440" width="540" height="100" fill="${band}"/><text x="30" y="500" font-family="Helvetica" font-size="34" font-weight="800" fill="#fff">${text}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};
const studio = {
  config: {
    enabled: true,
    role: 'owner',
    overlayMax: 60,
    brandKit: client.brandKit,
    credits: { budget: 30, monthSpend: 8.55, remaining: 21.45, exhausted: false },
    templates: [
      { id: 'open-left', name: 'Open — text left', kind: 'open', zone: { x: 0.06, y: 0.1, w: 0.46, h: 0.38 }, imageRect: null, logoCorner: null },
      { id: 'open-lower', name: 'Open — text lower', kind: 'open', zone: { x: 0.06, y: 0.56, w: 0.55, h: 0.32 }, imageRect: null, logoCorner: null },
      { id: 'band-bottom', name: 'Brand band — bottom', kind: 'band', zone: { x: 0.06, y: 0.84, w: 0.88, h: 0.13 }, imageRect: { x: 0, y: 0, w: 1, h: 0.82 }, logoCorner: null },
      { id: 'band-top', name: 'Brand band — top', kind: 'band', zone: { x: 0.06, y: 0.03, w: 0.88, h: 0.13 }, imageRect: { x: 0, y: 0.18, w: 1, h: 0.82 }, logoCorner: null },
      { id: 'panel-right', name: 'Brand panel — right', kind: 'panel', zone: { x: 0.66, y: 0.3, w: 0.3, h: 0.42 }, imageRect: { x: 0, y: 0, w: 0.62, h: 1 }, logoCorner: null },
      { id: 'logo-corner', name: 'Minimal — logo corner', kind: 'minimal', zone: { x: 0.06, y: 0.86, w: 0.7, h: 0.09 }, imageRect: null, logoCorner: 'top-right' }
    ],
    placements: [
      { id: 'square', label: 'Feed 1:1', w: 1080, h: 1080, ratio: '1:1' },
      { id: 'portrait', label: 'Feed 4:5', w: 1080, h: 1350, ratio: '4:5' },
      { id: 'story', label: 'Story 9:16', w: 1080, h: 1920, ratio: '9:16' },
      { id: 'landscape', label: 'Link 1.91:1', w: 1200, h: 628, ratio: '1.91:1' }
    ],
    models: [
      { id: 'nano-banana-pro', label: 'Nano Banana Pro', price: 0.15 },
      { id: 'gpt-image-2', label: 'GPT Image 2', price: 0.25 }
    ]
  },
  assets: [
    { metaPath: 'ws/demo-ws/demo1.json', path: 'demo1.png', url: svgAsset('#89A7B1', '#0E7C86', 'Straight teeth, quietly.'), placementId: 'square', overlay: { templateId: 'band-bottom', text: 'Straight teeth, quietly.' }, rung: 'original', saved: true, jobId: 'demo-job-1', createdAt: '2026-07-12T03:20:00Z' },
    { metaPath: 'ws/demo-ws/demo2.json', path: 'demo2.png', url: svgAsset('#B9A38C', '#0E7C86', 'Kids love us. Mostly.'), placementId: 'portrait', overlay: { templateId: 'band-bottom', text: 'Kids love us. Mostly.' }, rung: 'alternative', saved: false, jobId: 'demo-job-1', createdAt: '2026-07-12T03:21:00Z' },
    { metaPath: 'ws/demo-ws/demo3.json', path: 'demo3.png', url: svgAsset('#7E8CA8', '#0E7C86', 'Whiter in one visit.'), placementId: 'story', overlay: { templateId: 'band-bottom', text: 'Whiter in one visit.' }, rung: 'original', saved: false, jobId: 'demo-job-2', createdAt: '2026-07-14T08:10:00Z' },
    { metaPath: 'ws/demo-ws/demo4.json', path: 'demo4.png', url: svgAsset('#98AC90', '#0E7C86', 'Same-day emergencies.'), placementId: 'landscape', overlay: { templateId: 'band-bottom', text: 'Same-day emergencies.' }, rung: 'scrim', saved: false, jobId: 'demo-job-2', createdAt: '2026-07-14T08:12:00Z' }
  ]
};

fs.writeFileSync(path.join(OUT, 'daily.json'), JSON.stringify(daily));
fs.writeFileSync(path.join(OUT, 'structure.json'), JSON.stringify(structure, null, 2));
fs.writeFileSync(path.join(OUT, 'client.json'), JSON.stringify(client, null, 2));
fs.writeFileSync(path.join(OUT, 'studio.json'), JSON.stringify(studio));

// Compact 30-day summary for the server-side demo chat: pulse-chat ignores
// any client-sent context in demo mode and injects THIS instead.
const last30m = daily.meta.slice(-30);
const last30g = daily.google.slice(-30);
const sum = (rows, f) => rows.reduce((a, r) => a + f(r), 0);
const mSpend = r2(sum(last30m, (r) => r.spend));
const gSpend = r2(sum(last30g, (r) => r.spend));
const mMsg = sum(last30m, (r) => r.events[MSG]);
const gCalls = sum(last30g, (r) => r.events[GCALL]);
const demoContext = {
  demoClient: 'Northside Dental (sample data)',
  range: { since: dates[DAYS - 30], until: dates[DAYS - 1], days: 30 },
  meta: {
    spend: mSpend,
    impressions: sum(last30m, (r) => r.impressions),
    clicks: sum(last30m, (r) => r.clicks),
    enquiries_messaging: mMsg,
    leads: sum(last30m, (r) => r.events[LEAD]),
    costPerEnquiry: r2(mSpend / mMsg)
  },
  google: {
    spend: gSpend,
    impressions: sum(last30g, (r) => r.impressions),
    clicks: sum(last30g, (r) => r.clicks),
    calls: gCalls,
    bookingForms: sum(last30g, (r) => r.events[GFORM]),
    costPerCall: r2(gSpend / gCalls)
  },
  blended: { enquiries: mMsg + gCalls, spend: r2(mSpend + gSpend), costPerEnquiry: r2((mSpend + gSpend) / (mMsg + gCalls)) },
  note: 'The Whitening Promo campaign started scaling ~5 weeks ago; Meta cost per enquiry has been improving since.',
  campaigns: structure.meta.concat(structure.google).map((c) => ({ name: c.name, platform: c.id.startsWith('m') ? 'meta' : 'google', shareOfPlatformSpend: c.share }))
};
fs.writeFileSync('netlify/functions/_demoContext.json', JSON.stringify(demoContext, null, 2));

console.log('fixtures written:', fs.readdirSync(OUT).join(', '), '+ _demoContext.json');
console.log('sanity: meta 30d spend', mSpend, 'msg', mMsg, 'google 30d spend', gSpend, 'calls', gCalls);
