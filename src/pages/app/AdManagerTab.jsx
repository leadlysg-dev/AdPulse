import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useShell } from '../../components/Shell';
import DateSelector, { toView } from '../../components/DateSelector';
import TableControls, { filterPredicate } from '../../components/TableControls';
import { masterColumns, nodeValue, formatCol, goodUpFor } from '../../lib/metrics';

const money = (v) => 'S$' + (v || 0).toLocaleString('en-SG', { maximumFractionDigits: v >= 100 ? 0 : 2 });
const LOCK_TIP = 'Managed by Leadly — ask Pulse to request a change';
const THUMBS = ['t1', 't2', 't3', 't4', 't5', 't6'];

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

function Delta({ pct, goodUp }) {
  if (pct === null || pct === undefined || !isFinite(pct)) return null;
  const good = goodUp === null ? null : pct >= 0 === goodUp;
  const cls = good === null ? 'flat' : good ? 'up' : 'down';
  return (
    <span className={`delta delta-sm ${cls}`}>
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// The matched-length window immediately before [since, until].
function previousWindow(since, until) {
  const DAY = 86400000;
  const s = new Date(since + 'T00:00:00Z').getTime();
  const u = new Date(until + 'T00:00:00Z').getTime();
  const len = Math.round((u - s) / DAY) + 1;
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  return { since: fmt(s - len * DAY), until: fmt(s - DAY) };
}

export default function AdManagerTab() {
  const { status, role, toast } = useShell();
  const locked = role === 'client';
  const email = status?.email || '';

  const [range, setRange] = useState({ key: 'last_7d', label: 'Last 7 days' });
  const [compare, setCompare] = useState(false);
  const [trees, setTrees] = useState(null); // { meta, google }
  const [prevIndex, setPrevIndex] = useState(null); // "channel:id" -> metrics of the preceding period
  const [error, setError] = useState(null);
  const [platform, setPlatform] = useState('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [accounts, setAccounts] = useState(null); // { meta:{id,name}, google:{id,name} }
  const [config, setConfig] = useState(null);
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
    api.metricsConfig().then((r) => setConfig(r.config)).catch(() => {});
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

  // "vs previous period": fetch the matched-length preceding window's trees
  // once per range and index every node's metrics by channel:id, so every
  // cell can show its own delta - custom ranges included.
  useEffect(() => {
    if (!compare || !trees) {
      setPrevIndex(null);
      return;
    }
    let cancelled = false;
    const src = trees.meta?.state === 'ok' ? trees.meta : trees.google?.state === 'ok' ? trees.google : null;
    if (!src || !src.since || !src.until) return;
    const win = previousWindow(src.since, src.until);
    Promise.all([
      api.getManageTree(win, 'meta').catch(() => null),
      api.getManageTree(win, 'google').catch(() => null)
    ]).then(([m, g]) => {
      if (cancelled) return;
      const index = {};
      const walk = (channel, nodes) => {
        for (const nd of nodes || []) {
          index[`${channel}:${nd.id}`] = nd.metrics || {};
          walk(channel, nd.children);
        }
      };
      if (m?.state === 'ok') walk('meta', m.campaigns);
      if (g?.state === 'ok') walk('google', g.campaigns);
      setPrevIndex(index);
    });
    return () => {
      cancelled = true;
    };
  }, [compare, trees]);

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
  const cols = useMemo(() => masterColumns(config), [config]);
  const colById = useMemo(() => Object.fromEntries(cols.map((c) => [c.id, c])), [cols]);

  // Universal controls: search + "+ Filter" chips, no fixed filter buttons
  const filterFields = useMemo(
    () => [
      { id: 'status', label: 'Status', kind: 'choice', options: [{ value: 'active', label: 'Live' }, { value: 'paused', label: 'Paused' }] },
      { id: 'platform', label: 'Platform', kind: 'choice', options: [{ value: 'meta', label: 'Meta' }, { value: 'google', label: 'Google' }] },
      ...(accountNames.length > 1
        ? [{ id: 'account', label: 'Account', kind: 'choice', options: accountNames.map((n) => ({ value: n, label: n })) }]
        : []),
      { id: 'campaign', label: 'Campaign', kind: 'choice', options: (campaigns || []).map((c) => ({ value: c.name, label: c.name })).slice(0, 20) },
      ...cols.map((c) => ({ id: c.id, label: c.label, kind: 'number', money: /spend|cost|cpc|cpm/i.test(c.id) }))
    ],
    [accountNames, campaigns, cols]
  );

  const sortNodes = useCallback(
    (list, channel) => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      const out = [...list];
      if (sort.col === 'name') out.sort((a, b) => a.name.localeCompare(b.name) * dir);
      else if (colById[sort.col]) {
        const col = colById[sort.col];
        const chOf = (nd) => channel || nd.channel;
        out.sort((a, b) => ((nodeValue(col, a, chOf(a)) ?? -Infinity) - (nodeValue(col, b, chOf(b)) ?? -Infinity)) * dir);
      }
      return out;
    },
    [sort, colById]
  );

  const visible = useMemo(() => {
    if (!campaigns) return [];
    const valueOf = (c, field) =>
      field === 'status' ? c.status : field === 'platform' ? c.channel : field === 'account' ? c.accountName : field === 'campaign' ? c.name : nodeValue(colById[field], c, c.channel);
    const keep = filterPredicate(filters, filterFields, valueOf);
    const rows = campaigns.filter(
      (c) =>
        (platform === 'all' || c.channel === platform) &&
        keep(c) &&
        (!search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()))
    );
    return sortNodes(rows, null);
  }, [campaigns, platform, search, filters, filterFields, sortNodes, colById]);

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

  // Flatten campaign -> ad set / ad group -> ad into row descriptors first
  // (children sorted with the same comparator), so the last row of each
  // expanded group can carry the bracketing border class.
  const flatRows = useMemo(() => {
    const out = [];
    const push = (node, channel, canManage, depth) => {
      const key = nodeKey(channel, node.id);
      const isOpen = expanded.has(key);
      out.push({ node, channel, canManage, depth, key, isOpen, grpLast: false, grpOpen: depth === 0 && isOpen });
      if (isOpen) {
        for (const child of sortNodes(node.children || [], channel)) {
          push({ ...child, accountName: node.accountName }, channel, canManage, depth + 1);
        }
      }
    };
    for (const c of visible) {
      const before = out.length;
      push(c, c.channel, c.canManage, 0);
      if (out.length > before + 1) out[out.length - 1].grpLast = true;
    }
    return out;
  }, [visible, expanded, sortNodes]);

  const cellDelta = (col, node, channel) => {
    if (!compare || !prevIndex) return null;
    const prevMetrics = prevIndex[nodeKey(channel, node.id)];
    if (!prevMetrics) return null;
    const cur = nodeValue(col, node, channel);
    const prev = nodeValue(col, { metrics: prevMetrics }, channel);
    if (cur == null || prev == null || prev <= 0) return null;
    return ((cur - prev) / prev) * 100;
  };

  const renderRow = ({ node, channel, canManage, depth, key, isOpen, grpLast, grpOpen }) => {
    const rowLocked = locked || !canManage;
    const entityType = node.type || (depth === 0 ? 'campaign' : depth === 1 ? (channel === 'meta' ? 'adset' : 'adgroup') : 'ad');
    const isOn = node.status === 'active';
    const cls = [depth ? `lvl-${depth}` : 'lvl-0', grpOpen ? 'grp-open' : '', grpLast ? 'grp-last' : ''].filter(Boolean).join(' ');
    return (
      <tr key={key} className={cls}>
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
        {cols.map((col) => {
          const v = nodeValue(col, node, channel);
          const pct = cellDelta(col, node, channel);
          return (
            <td key={col.id} className="num">
              {formatCol(col, v)}
              {pct != null && <div><Delta pct={pct} goodUp={goodUpFor(col)} /></div>}
            </td>
          );
        })}
        <td>
          <Switch on={isOn} locked={rowLocked} busy={busy} label={`${node.name} on or off`} onToggle={() => write(channel, node, entityType, 'set_status', isOn ? 'paused' : 'active')} />
        </td>
      </tr>
    );
  };

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <div className="seg" role="group" aria-label="Platform">
          {[['all', 'All'], ['meta', 'Meta'], ['google', 'Google']].map(([id, label]) => (
            <button key={id} type="button" className={platform === id ? 'on' : ''} onClick={() => setPlatform(id)}>{label}</button>
          ))}
        </div>
        <TableControls
          search={search}
          onSearch={setSearch}
          filters={filters}
          onFilters={setFilters}
          fields={filterFields}
          placeholder="Search campaigns…"
        />
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
            <table className="spec-table adm-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th className="pin th-sort" onClick={() => setSortCol('name')}>
                    Campaigns{sort.col === 'name' && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                  </th>
                  <th>Status</th>
                  <th className="num">Budget</th>
                  {cols.map((c) => (
                    <th key={c.id} className="num th-sort" onClick={() => setSortCol(c.id)}>
                      {c.label}
                      {sort.col === c.id && <span className="dir">{sort.dir === 'desc' ? '↓' : '↑'}</span>}
                    </th>
                  ))}
                  <th>On/Off</th>
                </tr>
              </thead>
              <tbody>
                {flatRows.length === 0 && (
                  <tr>
                    <td />
                    <td className="pin" colSpan={4 + cols.length}>
                      <span className="section-sub">No campaigns match this view.</span>
                    </td>
                  </tr>
                )}
                {flatRows.map(renderRow)}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {compare && !prevIndex && campaigns && (
        <p className="section-sub" style={{ marginTop: 8 }}>Fetching the previous period for comparison…</p>
      )}
      {locked && (
        <p className="section-sub" style={{ marginTop: 10 }}>
          Your campaigns are managed by Leadly. Ask Pulse (on the Pulse tab) to request any change — budgets, pausing,
          new ads — and the team is notified instantly.
        </p>
      )}
    </>
  );
}
