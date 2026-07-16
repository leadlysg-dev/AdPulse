import { useState } from 'react';
import { studioService } from '../../lib/studioService';

// Studio per the v5 spec — prompt panel with Format / Aspect / Brand preset /
// Model, and the generation gallery. The whole tab ships LOCKED (blur +
// coming-soon card); the UI is wired to studioService, which is the single
// seam where fal.ai lands when it unlocks.
const GALLERY = [
  { t: 't1', fmt: 'Image · 1:1', name: 'Void deck — v1' },
  { t: 't2', fmt: 'Image · 1:1', name: 'Void deck — v2' },
  { t: 't4', fmt: 'Image · 1:1', name: 'Void deck — v3' },
  { t: 't5', fmt: 'Video · 9:16', name: 'Testimonial cutdown' },
  { t: 't6', fmt: 'Image · 4:5', name: 'Family static B' },
  { t: 't3', fmt: 'Ad set', name: 'Promo pack' }
];

function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" className={value === o ? 'on' : ''} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export default function StudioTab() {
  const [prompt, setPrompt] = useState('');
  const [format, setFormat] = useState('Image');
  const [aspect, setAspect] = useState('1:1');

  return (
    <div className="locked-wrap">
      <div className="locked-overlay">
        <div className="locked-card">
          <div className="lock-ico">
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </div>
          <h3>Studio is coming soon</h3>
          <p>Your ad creator is being polished. Pulse will let you know the moment it's ready.</p>
        </div>
      </div>

      <div className="locked-content" aria-hidden="true">
        <div className="studio-cols">
          <div className="scard prompt-box">
            <h2>Create</h2>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the ad you want — “retirement planning ad, warm family scene at HDB void deck, golden hour, space for headline top-left”"
            />
            <div className="opt-row">
              <span className="opt-label">Format</span>
              <Seg label="Format" options={['Image', 'Video', 'Ad set']} value={format} onChange={setFormat} />
            </div>
            <div className="opt-row">
              <span className="opt-label">Aspect ratio</span>
              <Seg label="Aspect ratio" options={['1:1', '4:5', '9:16']} value={aspect} onChange={setAspect} />
            </div>
            <div className="opt-row">
              <span className="opt-label">Brand preset</span>
              <button type="button" className="sbtn sbtn-ghost sbtn-sm">Legacy Planners ▾</button>
            </div>
            <div className="opt-row">
              <span className="opt-label">Model</span>
              <button type="button" className="sbtn sbtn-ghost sbtn-sm">Nano Banana Pro ▾</button>
            </div>
            <button
              type="button"
              className="sbtn sbtn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
              onClick={() => studioService.generate({ prompt, format, aspect }).catch(() => {})}
            >
              ✦ Generate variations
            </button>
            <p className="cache-note" style={{ marginTop: 10, textAlign: 'center' }}>
              Pulse writes the final prompt for you — tap any result to refine it in chat.
            </p>
          </div>

          <div>
            <div className="gen-strip">
              <span className="section-title">Recent generations</span>
              <span className="section-sub">Legacy Planners · today</span>
              <button type="button" className="sbtn sbtn-ghost sbtn-sm" style={{ marginLeft: 'auto' }}>History</button>
            </div>
            <div className="gallery">
              {GALLERY.map((g) => (
                <div className="g-item" key={g.name}>
                  <div className={`g-thumb ${g.t}`}>
                    <span className="fmt">{g.fmt}</span>
                    {g.name}
                  </div>
                  <div className="g-acts">
                    <button type="button" className="sbtn sbtn-primary sbtn-sm">→ Ad Manager</button>
                    <button type="button" className="sbtn sbtn-ghost sbtn-sm">Refine</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
