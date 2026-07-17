import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useShell } from '../../components/Shell';

// The platform-admin directory: every workspace, with health at a glance,
// "Enter workspace" (a logged admin session), and new-client creation that
// hands back the single-use owner invite link. The server gates every call
// on the platform_admin row; this page just also hides itself from
// non-admins so they never see a dead end.
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function HealthDot({ state, label }) {
  const cls = state === 'ok' ? label.toLowerCase() : 'off';
  const title = state === 'ok' ? `${label} connected` : state === 'partial' ? `${label} connected, no ad account picked` : `${label} not connected`;
  return (
    <span className="conn-chip" title={title}>
      <span className={`dot ${state === 'ok' ? cls : 'off'}`} style={state === 'partial' ? { background: 'var(--amber)' } : undefined} />
      {label}
    </span>
  );
}

function NewWorkspaceModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [managed, setManaged] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { workspace, invite }
  const { toast } = useShell();

  const create = async () => {
    if (!name.trim()) return setError('Give the workspace a name.');
    setBusy(true);
    setError('');
    try {
      const r = await api.adminWorkspaceCreate(name.trim(), managed);
      setResult(r);
      onCreated(r.workspace);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.invite.url);
      toast('Invite link copied.');
    } catch {
      window.prompt('Copy this link:', result.invite.url);
    }
  };

  return (
    <div className="mp-overlay" role="dialog" aria-label="New client workspace">
      <div className="scard mp-card mo-card">
        {!result && (
          <>
            <h2 className="mo-title">New client workspace</h2>
            <p className="mo-sub">Name it after the client. You'll get a single-use owner invite link to send them.</p>
            <label className="mo-name-label" htmlFor="nw-name">Workspace name</label>
            <input id="nw-name" className="budget-input mo-name" style={{ width: 280 }} autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="e.g. Tay Dental" />
            <label className="mo-name-label" style={{ marginTop: 16 }}>Managed mode</label>
            <p className="mo-sub" style={{ marginTop: 2 }}>Leadly runs the campaigns; the client gets read-mostly controls and asks Pulse for changes.</p>
            <button
              type="button"
              className={`switch${managed ? ' on' : ''}`}
              role="switch"
              aria-checked={managed}
              aria-label="Managed mode"
              style={{ marginTop: 8 }}
              onClick={() => setManaged((v) => !v)}
            />
            {error && <p className="mo-error" role="alert">{error}</p>}
            <div className="mp-foot">
              <button type="button" className="sbtn sbtn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="sbtn sbtn-primary" disabled={busy} onClick={create}>
                {busy ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </>
        )}
        {result && (
          <>
            <h2 className="mo-title">{result.workspace.name} is ready</h2>
            <p className="mo-sub">
              Send this single-use owner invite link to the client. It expires after first use or in seven days — you
              can mint a fresh one any time from the workspace's Settings.
            </p>
            <div className="invite-link-row">
              <code className="invite-link">{result.invite.url}</code>
              <button type="button" className="sbtn sbtn-primary sbtn-sm" onClick={copy}>Copy</button>
            </div>
            <div className="mp-foot">
              <button type="button" className="sbtn sbtn-ghost" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminTab() {
  const { status, toast } = useShell();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ col: 'lastActivity', dir: 'desc' });
  const [creating, setCreating] = useState(false);
  const [entering, setEntering] = useState(null);

  // Server-side the endpoints 403 non-admins; client-side we bounce them
  // before they see an empty shell.
  useEffect(() => {
    if (status && !status.isPlatformAdmin) window.location.href = '/pulse.html';
  }, [status]);

  const load = () => {
    setError(null);
    api
      .adminWorkspaces()
      .then((r) => setRows(r.workspaces))
      .catch((err) => setError(err.message));
  };
  useEffect(load, []);

  const visible = useMemo(() => {
    if (!rows) return [];
    const list = rows.filter((w) => !search.trim() || w.name.toLowerCase().includes(search.trim().toLowerCase()));
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (w) =>
      sort.col === 'name' ? w.name.toLowerCase() : sort.col === 'owner' ? w.ownerEmail || '' : sort.col === 'members' ? w.memberCount : w.lastActivity || '';
    list.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
    return list;
  }, [rows, search, sort]);
  const setSortCol = (col) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' }));

  const enter = async (w) => {
    setEntering(w.id);
    try {
      await api.adminEnter(w.id);
      window.location.href = '/pulse.html';
    } catch (err) {
      toast(err.message);
      setEntering(null);
    }
  };

  if (status && !status.isPlatformAdmin) return null;

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="pb-input" style={{ flex: '0 1 260px' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search workspaces…" aria-label="Search workspaces" />
        </div>
        <button type="button" className="sbtn sbtn-primary" style={{ marginLeft: 'auto' }} onClick={() => setCreating(true)}>
          + New client workspace
        </button>
      </div>

      {error && <div className="scard" style={{ padding: 16 }}><span className="section-sub">Couldn’t load workspaces: {error}</span></div>}
      {!rows && !error && <div className="scard" style={{ padding: 24 }}><div className="skeleton" style={{ height: 120 }} /></div>}

      {rows && (
        <div className="scard" style={{ overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="spec-table">
              <thead>
                <tr>
                  <th className="pin th-sort" onClick={() => setSortCol('name')}>
                    Workspace{sort.col === 'name' && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th className="th-sort" onClick={() => setSortCol('owner')}>
                    Owner{sort.col === 'owner' && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th>Connections</th>
                  <th className="num th-sort" onClick={() => setSortCol('members')}>
                    Members{sort.col === 'members' && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th className="th-sort" onClick={() => setSortCol('lastActivity')}>
                    Last activity{sort.col === 'lastActivity' && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th>Mode</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td className="pin" colSpan={7}>
                      <span className="section-sub">No workspaces match this search.</span>
                    </td>
                  </tr>
                )}
                {visible.map((w) => (
                  <tr key={w.id}>
                    <td className="pin">
                      <div className="tname">{w.name}</div>
                      <div className="tsub">Created {fmtDate(w.createdAt)}</div>
                    </td>
                    <td>{w.ownerEmail || <span className="section-sub">No owner yet — invite pending</span>}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <HealthDot state={w.meta} label="Meta" />
                        <HealthDot state={w.google} label="Google" />
                      </div>
                    </td>
                    <td className="num">{w.memberCount}</td>
                    <td>{fmtDate(w.lastActivity)}</td>
                    <td>
                      <span className={`pill ${w.managed ? 'live' : 'paused'}`}>{w.managed ? 'Managed' : 'Self-serve'}</span>
                    </td>
                    <td>
                      <button type="button" className="sbtn sbtn-ghost sbtn-sm" disabled={entering === w.id} onClick={() => enter(w)}>
                        {entering === w.id ? 'Entering…' : 'Enter workspace'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && <NewWorkspaceModal onClose={() => setCreating(false)} onCreated={() => load()} />}
    </>
  );
}
