import './Banner.css';

const ICONS = {
  warning: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 L22 20 L2 20 Z" stroke="var(--status-warning)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="var(--status-warning)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="var(--status-warning)" />
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="var(--series-1)" strokeWidth="2" />
      <path d="M12 11v5" stroke="var(--series-1)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r="1" fill="var(--series-1)" />
    </svg>
  ),
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="var(--status-good)" strokeWidth="2" />
      <path d="M8 12.5l2.5 2.5L16 9" stroke="var(--status-good)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
};

export default function Banner({ tone = 'info', children }) {
  return (
    <div className={`banner banner-${tone}`} role="status">
      {ICONS[tone]}
      <span>{children}</span>
    </div>
  );
}
