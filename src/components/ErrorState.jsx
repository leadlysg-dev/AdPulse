import './ErrorState.css';

export default function ErrorState({ message, onRetry }) {
  return (
    <div className="error-state card" role="alert">
      <div className="error-state-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="var(--status-critical)" strokeWidth="2" />
          <path d="M12 7v6" stroke="var(--status-critical)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="16.5" r="1.2" fill="var(--status-critical)" />
        </svg>
      </div>
      <div>
        <p className="error-state-title">Couldn't load this data</p>
        <p className="error-state-message">{message}</p>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
