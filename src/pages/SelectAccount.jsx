import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import ErrorState from '../components/ErrorState';
import './SelectAccount.css';

export default function SelectAccount() {
  const [params] = useSearchParams();
  const provider = params.get('provider') === 'google' ? 'google' : 'meta';
  const providerLabel = provider === 'meta' ? 'Meta' : 'Google';

  const [accounts, setAccounts] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    setAccounts(null);
    try {
      const data = await api.listAccounts();
      setAccounts(data[provider].adAccounts || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  async function handleConfirm() {
    setSaving(true);
    try {
      await api.selectAccount(provider, selectedId);
      window.location.href = '/dashboard.html?connected=' + provider;
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="select-account-page">
      <div className="select-account-card card">
        <h1>Which {providerLabel} ad account should we track?</h1>
        <p className="select-account-sub">
          You manage more than one — pick the one you want on your dashboard. You can change this later.
        </p>

        {error && <ErrorState message={error} onRetry={load} />}

        {!error && accounts === null && (
          <div className="select-account-list">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton select-account-skeleton-row" />
            ))}
          </div>
        )}

        {!error && accounts && (
          <>
            <div className="select-account-list" role="radiogroup" aria-label="Ad accounts">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className={`select-account-option${selectedId === acc.id ? ' selected' : ''}`}
                  role="radio"
                  aria-checked={selectedId === acc.id}
                  tabIndex={0}
                  onClick={() => setSelectedId(acc.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(acc.id);
                    }
                  }}
                >
                  <span className="select-account-name">{acc.name}</span>
                  <span className="select-account-id">{acc.id}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-primary"
              disabled={!selectedId || saving}
              onClick={handleConfirm}
            >
              {saving ? 'Saving…' : 'Confirm selection'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
