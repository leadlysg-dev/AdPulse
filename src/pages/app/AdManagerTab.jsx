import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useShell } from '../../components/Shell';
import DateSelector, { toView } from '../../components/DateSelector';
import MetricsPicker from '../../components/MetricsPicker';
import { labelFor, DEFAULT_TRACKED } from '../../lib/metrics';

const money = (v) => 'S$' + (v || 0).toLocaleString('en-SG', { maximumFractionDigits: v >= 100 ? 0 : 2 });
const LOCK_TIP = 'Managed by Leadly — ask Pulse to request a change';
const THUMBS = ['t1', 't2', 't3', 't4', 't5', 't6'];

// column definitions over the tree's per-level metrics; ids align with the
// tracked-metrics vocabulary so both tabs follow the same source
const COL_DEFS = [
  ['spend', 'Spend', (m) => money(m.spend || 0), (m) => m.spend || 0],
  ['impressions', 'Impr.', (m) => (m.impressions || 0).toLocaleString(), (m) => m.impressions || 0],
  ['clicks', 'Clicks', (m) => (m.clicks || 0).toLocaleString(), (m) => m.clicks || 0],
  ['ctr', 'CTR', (m) => (m.ctr != null ? m.ctr.toFixed(2) + '%' : '—'), (m) => m.ctr ?? -1],
  ['cpc', 'CPC', (m) => (m.cpc != null ? money(m.cpc) : '—'), (m) => m.cpc ?? -1],
  ['enquiries', 'Leads', (m) => m.conversions ?? '—', (m) => m.conversions ?? -1],
  ['cpe', 'CPL', (m) => (m.cpa != null ? money(m.cpa) : '—'), (m) => m.cpa ?? Infinity],
  ['conv_rate', 'Conv. rate', (m) => (m.clicks > 0 && m.conversions != null ? ((m.conversions / m.clicks) * 100).toFixed(1) + '%' : '—'), (m) => (m.clicks > 0 ? (m.conversions || 0) / m.clicks : -1)],
  ['roas', 'ROAS', (m) => (m.roas != null ? m.roas.toFixed(1) + '×' : '—'), (m) => m.roas ?? -1]
];

function Switch({ on, locked, busy, label, onToggle }) {
  return (
    <span className={locked ? 'locktip' : ''} data-tip={locked ? LOCK_TIP : undefined}>
      <button type="button" className={`switch rowswitch${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} disabled={locked || busy} onClick={onToggle} />
    </span>
  );
}

function BudgetCell({ node, locked, busy, onBudget }) {
  const [editing, setEditing] = useState(false);
  if (!node.budget || !node.editableBudget) return <span className="section-sub">—</span>;
  if (editing && !locked) {
    return (
      <input
        className="budget-input"
        autoFocus
        inputMode="decimal"
        defaultValue={node.budget.amount}
        aria-label={`Budget for ${node.name}`}
        onBlur={(e) => {
          setEditing(false);
          const v = parseFloat(e.target.value);
          if (isFinite(v) && v > 0 && v !== node.budget.amount) onBudget(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <span className={locked ? 'locktip' : ''} data-tip={locked ? LOCK_TIP : undefined}>
      <button type="button" className="budget-edit" disabled={locked || busy} onClick={() => setEditing(true)}>
        {money(node.budget.amount)}
        {node.budget.type === 'daily' ? '' : ' total'} ✎
      </button>
    </span>
  );
}

export default function AdManagerTab() {
  const { status, role, toast } = useShell();
  const locked = role === 'client';
  const email = status?.email || '';

  const [range, setRange] = useState({ key: 'last_7d', label: 'Last 7 days' });
  const [compare, setCompare] = useState(false);
  const [trees, setTrees] = useState(null); // { meta, google }
  const [error, setError] = useState(null);
  const [platform, setPlatform] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [accounts, setAccounts] = useState(null); // { meta:{id,name}, google:{id,name} }
  const [tracked, setTracked] = useState(DEFAULT_TRACKED);
  const [customLabels, setCustomLabels] = useState({});
  const [picker, setPicker] = useState(false);
  const [showAllCols, setShowAllCols] = useState(false);
  // last-used sort persists per user
  const sortKey = `adm-sort:${email}`;
  const [sort, setSort] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`adm-sort:${email}`)) || { col: 'spend', dir: 'desc' };
    } catch {
      return { col: 'spend', dir: 'desc' };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(sortKey, JSON.stringify(sort));
    } catch {
      // storage unavailable - sort just won't persist
    }
  }, [sort, sortKey]);

  useEffect(() => {
    api.trackedMetrics().then((r) => r.metrics?.length && setTracked(r.metrics)).catch(() => {});
    api
      .listAccounts()
      .then((r) => {
        const pick = (p) => {
          const prov = r?.[p] || r?.providers?.[p];
          if (!prov) return null;
          const sel = (prov.adAccounts || []).find((a) => a.id === prov.selectedAdAccountId) || (prov.adAccounts || [])[0];
          return sel ? { id: sel.id, name: sel.name || sel.id } : null;
        };
        setAccounts({ meta: pick('meta'), google: pick('google') });
      })
      .catch(() => setAccounts({}));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setTrees(null);
    setSelected(new Set());
    setExpanded(new Set());
    try {
      const view = toView(range);
      const [meta, google] = await Promise.all([
        api.getManageTree(view, 'meta').catch(() => null),
        api.getManageTree(view, 'google').catch(() => null)
      ]);
      setTrees({ meta, google });
    } catch (err) {
      setError(err.message);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const campaigns = useMemo(() => {
    if (!trees) return null;
    const all = [];
    for (const channel of ['meta', 'google']) {
      const t = trees[channel];
      if (t?.state === 'ok') {
        for (const c of t.campaigns || []) all.push({ ...c, channel, accountName: t.accountName || channel, canManage: t.canManage });
      }
    }
    return all;
  }, [trees]);

  const accountNames = useMemo(() => [...new Set((campaigns || []).map((c) => c.accountName))], [campaigns]);

  const colFor = (id) => COL_DEFS.find(([d]) => d === id);
  const visibleCols = useMemo(() => {
    const trackedCols = tracked.filter((id) => colFor(id) || id.startsWith('event:'));
    return showAllCols
      ? [...COL_DEFS.map(([id]) => id), ...tracked.filter((id) => id.startsWith('event:'))]
      : trackedCols.length ? trackedCols : ['spend', 'enquiries', 'cpe'];
  }, [tracked, showAllCols]);

  const visible = useMemo(() => {
    if (!campaigns) return [];
    const rows = campaigns.filter(
      (c) =>
        (platform === 'all' || c.channel === platform) &&
        (statusFilter === 'all' || (statusFilter === 'fatigue' ? c.fatigue : c.status === statusFilter)) &&
        (accountFilter === 'all' || c.accountName === accountFilter) &&
        (!search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()))
    );
    const def = colFor(sort.col);
    if (def) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows.sort((a, b) => (def[3](a.metrics || {}) - def[3](b.metrics || {})) * dir);
    } else if (sort.col === 'name') {
      const dir = sort.dir === 'asc' ? 1 : -1;
      rows.sort((a, b) => a.name.localeCompare(b.name) * dir);
    }
    return rows;
  }, [campaigns, platform, statusFilter, accountFilter, search, sort]);

  const setSortCol = (col) =>
    setSort((s) => (s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' }));

  const write = async (channel, node, entityType, action, value) => {
    setBusy(true);
    try {
      let r = await api.manageEntity({ channel, entityType, entityId: node.id, entityName: node.name, action, value });
      if (r.needsAck) {
        if (window.confirm(`${r.reason}\n\nGo ahead?`)) {
          r = await api.manageEntity({ channel, entityType, entityId: node.id, entityName: node.name, action, value, acknowledged: true });
        } else {
          setBusy(false);
          return;
        }
      }
      if (r.error) throw new Error(r.error);
      toast(action === 'set_status' ? (value === 'paused' ? `${node.name} paused.` : `${node.name} is live.`) : `${node.name} budget updated.`);
      await load();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const bulk = async (action, value) => {
    const entities = visible.filter((c) => selected.has(`${c.channel}:${c.id}`));
    setBusy(true);
    try {
      for (const channel of ['meta', 'google']) {
        const list = entities.filter((c) => c.channel === channel);
        if (!list.length) continue;
        const r = await api.manageBulk({ channel, entityType: 'campaign', action, value, acknowledged: true, entities: list.map((c) => ({ id: c.id, name: c.name })) });
        if (r.error) throw new Error(r.error);
      }
      toast(action === 'set_status' ? `${entities.length} paused.` : `${entities.length} budgets updated.`);
      setSelected(new Set());
      await load();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  // platform-aware "New campaign": deep-link into the connected account's
  // native creator; a single connected platform skips the menu
  const createOn = (channel) => {
    setNewOpen(false);
    if (locked) {
      api.changeRequestCreate({ request: `Please create a new ${channel === 'meta' ? 'Meta' : 'Google'} campaign for us.` })
        .then(() => toast('Sent to Leadly — they’ll set it up with you.'))
        .catch((err) => toast(err.message));
      return;
    }
    const acct = accounts?.[channel];
    const url =
      channel === 'meta'
        ? `https://adsmanager.facebook.com/adsmanager/creation${acct ? `?act=${String(acct.id).replace(/^act_/, '')}` : ''}`
        : 'https://ads.google.com/aw/campaigns/new';
    window.open(url, '_blank', 'noopener');
  };
  const connectedPlatforms = ['meta', 'google'].filter((p) => (p === 'meta' ? status?.metaConnected : status?.googleConnected));

  const nodeKey = (channel, id) => `${channel}:${id}`;
  const toggleExpand = (key) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // rows render campaign → ad sets/ad groups → ads; children mount on first
  // expand (lazy), each level carrying the same metric columns
  const renderNode = (node, channel, canManage, depth, out) => {
    const key = nodeKey(channel, node.id);
    const isOpen = expanded.has(key);
    const rowLocked = locked || !canManage;
    const entityType = node.type || (depth === 0 ? 'campaign' : depth === 1 ? (channel === 'meta' ? 'adset' : 'adgroup') : 'ad');
    const isOn = node.status === 'active';
    out.push(
      <tr key={key} className={depth ? `lvl-${depth}` : ''}>
        <td style={{ width: 36 }}>
          {depth === 0 && (
            <button type="button" className={`cb${selected.has(key) ? ' on' : ''}`} aria-label={`Select ${node.name}`} disabled={rowLocked}
              onClick={() => setSelected((cur) => { const n = new Set(cur); n.has(key) ? n.delete(key) : n.add(key); return n; })} />
          )}
        </td>
        <td className="pin">
          <div className="adm-name-cell">
            {node.children?.length ? (
              <button type="button" className={`row-toggle${isOpen ? ' open' : ''}`} aria-expanded={isOpen} aria-label={`Expand ${node.name}`} onClick={() => toggleExpand(key)}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2l5 4-5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            ) : (
              <span style={{ width: 20 }} />
            )}
            {depth === 2 && <div className={`ad-thumb ${THUMBS[(node.id || '').length % THUMBS.length]}`}>AD</div>}
            <div>
              <div className="tname">{node.name}</div>
              {depth === 0 && (
                <div className="tsub">
                  <span className="plat"><span className={`dot ${channel}`} />{channel === 'meta' ? 'Meta' : 'Google'}</span>
                  {' · '}{node.accountName}
                  {node.children?.length ? ` · ${node.children.length} ${channel === 'meta' ? 'ad set' : 'ad group'}${node.children.length > 1 ? 's' : ''}` : ''}
                </div>
              )}
            </div>
          </div>
        </td>
        <td><span className={`pill ${isOn ? 'live' : 'paused'}`}>{isOn ? 'Live' : 'Paused'}</span></td>
        <td className="num">
          <BudgetCell node={node} locked={rowLocked} busy={busy} onBudget={(v) => write(channel, node, entityType, 'set_budget', v)} />
        </td>
        {visibleCols.map((id) => {
          const def = colFor(id);
          return (
            <td key={id} className="num">{def ? def[2](node.metrics || {}) : '—'}</td>
          );
        })}
        <td>
          <Switch on={isOn} locked={rowLocked} busy={busy} label={`${node.name} on or off`} onToggle={() => write(channel, node, entityType, 'set_status', isOn ? 'paused' : 'active')} />
        </td>
      </tr>
    );
    if (isOpen) for (const child of node.children || []) renderNode({ ...child, accountName: node.accountName }, channel, canManage, depth + 1, out);
  };

  const rows = [];
  for (const c of visible) renderNode(c, c.channel, c.canManage, 0, rows);

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="seg" role="group" aria-label="Platform">
          {[['all', 'All'], ['meta', 'Meta'], ['google', 'Google']].map(([id, label]) => (
            <button key={id} type="button" className={platform === id ? 'on' : ''} onClick={() => setPlatform(id)}>{label}</button>
          ))}
        </div>
        <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter">
          <option value="all">Status: All</option>
          <option value="active">Live</option>
          <option value="paused">Paused</option>
          <option value="fatigue">Fatigue</option>
        </select>
        {accountNames.length > 1 && (
          <select className="filter-select" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="Account filter">
            <option value="all">All accounts</option>
            {accountNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        )}
        <div className="pb-input" style={{ flex: '0 1 240px' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns…" aria-label="Search campaigns" />
        </div>
        <button type="button" className="sbtn sbtn-ghost sbtn-sm" onClick={() => setPicker(true)}>Edit tracked metrics</button>
        <button type="button" className="sbtn sbtn-ghost sbtn-sm" aria-pressed={showAllCols} onClick={() => setShowAllCols((v) => !v)}>
          {showAllCols ? 'Tracked columns' : 'Show all columns'}
        </button>
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <button
            type="button"
            className="sbtn sbtn-primary"
            onClick={() => {
              if (connectedPlatforms.length === 1) return createOn(connectedPlatforms[0]);
              setNewOpen((v) => !v);
            }}
          >
            + New campaign ▾
          </button>
          {newOpen && (
            <div className="scard" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 'var(--z-dropdown)', minWidth: 250, boxShadow: 'var(--shadow-pop)' }}>
              {['meta', 'google'].map((p) => (
                <button key={p} type="button" className="nav-item" style={{ color: 'var(--ink)' }} disabled={!connectedPlatforms.includes(p)} onClick={() => createOn(p)}>
                  <span className={`dot ${p}`} />
                  <span>
                    <span style={{ display: 'block', fontWeight: 600 }}>Create on {p === 'meta' ? 'Meta' : 'Google'}</span>
                    <span className="tsub">{accounts?.[p]?.name || (connectedPlatforms.includes(p) ? 'Connected account' : 'Not connected')}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <DateSelector value={range} onChange={setRange} compare={compare} onCompare={setCompare} />

      {selected.size > 0 && !locked && (
        <div className="bulkbar">
          <span>{selected.size} selected</span>
          <button type="button" className="sbtn sbtn-ghost sbtn-sm" disabled={busy} onClick={() => bulk('set_status', 'paused')}>Pause</button>
          <button type="button" className="sbtn sbtn-ghost sbtn-sm" onClick={() => toast('Duplicate is coming soon.')}>Duplicate</button>
          <button type="button" className="sbtn sbtn-ghost sbtn-sm" disabled={busy}
            onClick={() => { const v = window.prompt('Set the daily budget for every selected campaign to (S$):'); const n = parseFloat(v); if (isFinite(n) && n > 0) bulk('set_budget', n); }}>
            Edit budgets
          </button>
        </div>
      )}

      {error && <div className="scard" style={{ padding: 16 }}><span className="section-sub">Couldn’t load campaigns: {error}</span></div>}
      {!campaigns && !error && <div className="scard" style={{ padding: 24 }}><div className="skeleton" style={{ height: 120 }} /></div>}

      {campaigns && (
        <div className="scard" style={{ overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="spec-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th className="pin th-sort" onClick={() => setSortCol('name')}>
                    Campaigns{sort.col === 'name' && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th>Status</th>
                  <th className="num">Budget</th>
                  {visibleCols.map((id) => (
                    <th key={id} className="num th-sort" onClick={() => setSortCol(id)}>
                      {colFor(id)?.[1] || labelFor(id, customLabels)}
                      {sort.col === id && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                    </th>
                  ))}
                  <th>On/Off</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td />
                    <td className="pin" colSpan={4 + visibleCols.length}>
                      <span className="section-sub">No campaigns match these filters.</span>
                    </td>
                  </tr>
                )}
                {rows}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {locked && (
        <p className="section-sub" style={{ marginTop: 10 }}>
          Your campaigns are managed by Leadly. Ask Pulse (on the Pulse tab) to request any change — budgets, pausing,
          new ads — and the team is notified instantly.
        </p>
      )}

      {picker && (
        <MetricsPicker
          initial={tracked}
          onClose={() => setPicker(false)}
          onSaved={(metrics, labels) => {
            setTracked(metrics);
            setCustomLabels((cur) => ({ ...cur, ...labels }));
            setPicker(false);
            toast('Tracked metrics saved.');
          }}
        />
      )}
    </>
  );
}
