import './ConnectRow.css';

function ConnectPill({ provider, label, connected }) {
  return (
    <a
      href={`/.netlify/functions/auth-${provider}`}
      className={`connect-pill${connected ? ' connect-pill-connected' : ''}`}
    >
      {connected && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {connected ? `${label} connected` : `Connect ${label}`}
    </a>
  );
}

export default function ConnectRow({ metaConnected, googleConnected }) {
  return (
    <div className="connect-row">
      <ConnectPill provider="meta" label="Meta" connected={metaConnected} />
      <ConnectPill provider="google" label="Google" connected={googleConnected} />
    </div>
  );
}
