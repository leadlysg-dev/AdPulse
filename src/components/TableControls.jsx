import { useEffect, useRef, useState } from 'react';

// Universal table controls: search-as-you-type plus a "+ Filter" button
// that opens a field menu (Status, Platform, Account, any metric with
// greater-than / less-than / between). Applied filters render as removable
// chips and combine. No fixed filter buttons anywhere - this replaces them.
//
// fields: [{ id, label, kind: 'choice', options: [{ value, label }] }
//          | { id, label, kind: 'number', money?: true }]
// filters: [{ field, op, value, value2?, display }]

export function filterPredicate(filters, fields, valueOf) {
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  return (row) =>
    filters.every((f) => {
      const def = byId[f.field];
      if (!def) return true;
      const v = valueOf(row, f.field);
      if (def.kind === 'choice') return String(v) === String(f.value);
      if (v == null || !isFinite(v)) return false;
      if (f.op === 'gt') return v > f.value;
      if (f.op === 'lt') return v < f.value;
      if (f.op === 'between') return v >= Math.min(f.value, f.value2) && v <= Math.max(f.value, f.value2);
      return true;
    });
}

const OP_LABEL = { gt: '>', lt: '<', between: 'between' };

export default function TableControls({ search, onSearch, filters, onFilters, fields, placeholder }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(null); // field being configured
  const [op, setOp] = useState('gt');
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) {
        setOpen(false);
        setPicking(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const add = (filter) => {
    onFilters([...filters, filter]);
    setOpen(false);
    setPicking(null);
    setV1('');
    setV2('');
    setOp('gt');
  };

  const applyNumber = () => {
    const a = parseFloat(v1);
    const b = parseFloat(v2);
    if (!isFinite(a) || (op === 'between' && !isFinite(b))) return;
    add({
      field: picking.id,
      op,
      value: a,
      value2: op === 'between' ? b : undefined,
      display: `${picking.label} ${OP_LABEL[op]} ${op === 'between' ? `${a}–${b}` : a}`
    });
  };

  return (
    <>
      <div className="pb-input" style={{ flex: '0 1 240px' }}>
        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder || 'Search…'} aria-label={placeholder || 'Search'} />
      </div>
      <div ref={wrap} style={{ position: 'relative' }}>
        <button type="button" className="sbtn sbtn-ghost sbtn-sm" aria-expanded={open} onClick={() => { setOpen((v) => !v); setPicking(null); }}>
          + Filter
        </button>
        {open && (
          <div className="scard fpop">
            {!picking &&
              fields.map((f) => (
                <button key={f.id} type="button" className="fpop-item" onClick={() => setPicking(f)}>
                  {f.label}
                  <span className="fpop-kind">{f.kind === 'choice' ? '' : '# metric'}</span>
                </button>
              ))}
            {picking && picking.kind === 'choice' && (
              <>
                <div className="fpop-head">{picking.label}</div>
                {picking.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="fpop-item"
                    onClick={() => add({ field: picking.id, op: 'eq', value: o.value, display: `${picking.label}: ${o.label}` })}
                  >
                    {o.label}
                  </button>
                ))}
              </>
            )}
            {picking && picking.kind === 'number' && (
              <div className="fpop-num">
                <div className="fpop-head">{picking.label}</div>
                <select className="filter-select" value={op} onChange={(e) => setOp(e.target.value)} aria-label="Comparison">
                  <option value="gt">greater than</option>
                  <option value="lt">less than</option>
                  <option value="between">between</option>
                </select>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="budget-input" style={{ width: op === 'between' ? 80 : 120 }} inputMode="decimal" value={v1} placeholder={picking.money ? 'S$' : '0'} onChange={(e) => setV1(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyNumber()} autoFocus />
                  {op === 'between' && (
                    <input className="budget-input" style={{ width: 80 }} inputMode="decimal" value={v2} placeholder="and…" onChange={(e) => setV2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && applyNumber()} />
                  )}
                </div>
                <button type="button" className="sbtn sbtn-primary sbtn-sm" onClick={applyNumber}>Apply</button>
              </div>
            )}
          </div>
        )}
      </div>
      {filters.map((f, i) => (
        <button
          key={`${f.field}:${i}`}
          type="button"
          className="fchip"
          title="Remove filter"
          onClick={() => onFilters(filters.filter((_, j) => j !== i))}
        >
          {f.display} <span aria-hidden="true">×</span>
        </button>
      ))}
    </>
  );
}
