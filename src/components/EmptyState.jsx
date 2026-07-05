import './EmptyState.css';

export default function EmptyState({ title, message, children }) {
  return (
    <div className="empty-state card">
      <div className="empty-state-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M4 19h16M7 15V9m5 6V5m5 10v-4" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-message">{message}</p>
      {children && <div className="empty-state-actions">{children}</div>}
    </div>
  );
}
