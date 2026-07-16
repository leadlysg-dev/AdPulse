// COPY RULE: no hardcoded numbers or percentages in static copy - module
// stats show quiet dashes until they render from the workspace's real data.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

// Automations per the v5 spec: four module cards with stats + toggles
// (persisted per user), and the per-module flow visualization. The whole
// tab ships LOCKED (blur + coming-soon card) exactly like Studio.
const MODULES = [
  {
    id: 'messaging',
    name: 'Messaging',
    color: 'var(--green)',
    sub: 'Instant WhatsApp reply to every new lead, then routes to you.',
    stat: ['—', ' avg. first reply'],
    icon: (
      <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
        <path d="M14 7.6A6 6 0 0 1 3.4 12L1.5 14.5l.9-3A6 6 0 1 1 14 7.6z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
    flow: {
      sub: 'Runs on every new lead',
      steps: [
        ['Trigger', 'New lead created', 'From any Meta or Google form'],
        ['Wait', 'A short pause', 'Feels human, not robotic'],
        ['WhatsApp', 'Send greeting + qualify', '“Hi {first name}, thanks for…”'],
        ['Branch', 'Replied quickly?', 'Yes → notify adviser · No → nudge'],
        ['CRM', 'Tag + assign in CRM', 'Pipeline: New → Contacted']
      ]
    }
  },
  {
    id: 'email',
    name: 'Email',
    color: 'var(--cobalt)',
    sub: "A step-by-step nurture for leads who don't book quickly.",
    stat: ['—', ' open rate'],
    icon: (
      <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="3" width="13" height="10" rx="2" stroke="#fff" strokeWidth="1.5" />
        <path d="M2 4.5L8 9l6-4.5" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
    flow: {
      sub: 'Runs when a lead hasn’t booked yet',
      steps: [
        ['Trigger', 'No booking yet', 'Lead is still in “New”'],
        ['Email 1', 'The helpful nudge', 'Answers the top question they asked'],
        ['Wait', 'A couple of days', 'Room to reply on their own'],
        ['Emails', 'Proof, then the offer', 'Case story → FAQ → booking link'],
        ['CRM', 'Mark as nurtured', 'Booked → pipeline moves itself']
      ]
    }
  },
  {
    id: 'winback',
    name: 'Win-Back',
    color: '#6B32AD',
    sub: 'Re-engages cold leads automatically after they go quiet.',
    stat: ['—', ' recovered this month'],
    icon: (
      <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
        <path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9M2.5 8V4.5M2.5 8H6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    flow: {
      sub: 'Runs on leads that have gone quiet',
      steps: [
        ['Trigger', 'Lead has gone cold', 'No reply, no booking'],
        ['WhatsApp', 'First check-in', '“Still thinking it over? Here to help.”'],
        ['Wait', 'A longer pause', 'No pressure in between'],
        ['Email', 'The last word', 'One final offer, easy opt-out'],
        ['CRM', 'Recovered or archived', 'Replies re-open the pipeline']
      ]
    }
  },
  {
    id: 'gmb',
    name: 'Google My Business',
    color: 'var(--amber)',
    sub: 'Drafts a reply to every review — you approve before it posts.',
    stat: ['—', ' awaiting approval'],
    icon: (
      <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5l2 4.1 4.5.6-3.3 3.2.8 4.5L8 11.8l-4 2.1.8-4.5L1.5 6.2 6 5.6 8 1.5z" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
    flow: {
      sub: 'Runs on every new Google review',
      steps: [
        ['Trigger', 'New review posted', 'Any star rating'],
        ['Draft', 'Reply written for you', 'Matches your tone, names the reviewer'],
        ['Approve', 'A tap from you', 'Edit or approve from WhatsApp'],
        ['Post', 'Reply goes live', 'Shortly after you approve'],
        ['CRM', 'Reviewer logged', '5-star reviewers asked for referrals']
      ]
    }
  }
];

export default function AutomationsTab() {
  const [active, setActive] = useState('messaging');
  const [modules, setModules] = useState({ messaging: true, email: true, winback: true, gmb: true });

  useEffect(() => {
    let cancelled = false;
    api
      .automationSettings()
      .then((r) => !cancelled && r.modules && setModules(r.modules))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id) => {
    const next = !modules[id];
    setModules((m) => ({ ...m, [id]: next }));
    api.automationSettingsSave(id, next).catch(() => {});
  };

  const mod = MODULES.find((m) => m.id === active);

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
          <h3>Automations are coming soon</h3>
          <p>Messaging, Email, Win-Back and Google My Business will switch on here. Pulse will tell you when they're live.</p>
        </div>
      </div>

      <div className="locked-content" aria-hidden="true">
        <div className="auto-grid">
          {MODULES.map((m) => (
            <div key={m.id} className={`scard auto-card${active === m.id ? ' on' : ''}`} onClick={() => setActive(m.id)}>
              <div className="auto-ico" style={{ background: m.color }}>
                {m.icon}
              </div>
              <div>
                <div className="auto-name">{m.name}</div>
                <div className="auto-sub">{m.sub}</div>
              </div>
              <div className="auto-foot">
                <span className="auto-stat">
                  <b>{m.stat[0]}</b>
                  {m.stat[1]}
                </span>
                <button
                  type="button"
                  className={`switch${modules[m.id] ? ' on' : ''}`}
                  role="switch"
                  aria-checked={!!modules[m.id]}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(m.id);
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="section-head">
          <span className="section-title">{mod.name} — flow</span>
          <span className="section-sub">{mod.flow.sub}</span>
        </div>
        <div className="scard flow">
          {mod.flow.steps.map(([tag, name, sub], i) => (
            <span key={name} style={{ display: 'contents' }}>
              {i > 0 && (
                <div className="step-link">
                  <svg width="20" height="10" viewBox="0 0 20 10" fill="none">
                    <path d="M0 5h16m0 0l-4-4m4 4l-4 4" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </div>
              )}
              <div className="step">
                <div className="step-tag">{tag}</div>
                <div className="step-name">{name}</div>
                <div className="step-sub">{sub}</div>
              </div>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
