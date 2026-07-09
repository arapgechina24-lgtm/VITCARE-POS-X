'use client';
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Search, Pencil, Trash2, PackagePlus, Download, Upload, X } from 'lucide-react';
import { db, logAudit, uid } from '@/lib/db';
import { daysUntil, downloadCSV, KES } from '@/lib/utils';
import { sounds } from '@/lib/sounds';
import type { Drug } from '@/lib/types';

const EMPTY: Omit<Drug, 'id' | 'updatedAt'> = {
  name: '', genericName: '', strength: '', dosageForm: 'Tablet', manufacturer: '',
  batchNumber: '', expiryDate: '', stock: 0, reorderLevel: 10, unitPrice: 0,
  taxRate: 0, category: 'General', barcode: '', notes: '',
};

export default function InventoryPage() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'expiring'>('all');
  const [editing, setEditing] = useState<Drug | 'new' | null>(null);
  const [restock, setRestock] = useState<Drug | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const drugs = useLiveQuery(async () => {
    let all = await db.drugs.orderBy('name').toArray();
    const term = q.trim().toLowerCase();
    if (term) all = all.filter((d) => [d.name, d.genericName, d.category, d.barcode, d.batchNumber].some((f) => f.toLowerCase().includes(term)));
    if (filter === 'low') all = all.filter((d) => d.stock <= d.reorderLevel);
    if (filter === 'expiring') all = all.filter((d) => daysUntil(d.expiryDate) <= 90);
    return all;
  }, [q, filter], []);

  async function save(d: Drug) {
    d.updatedAt = Date.now();
    await db.drugs.put(d);
    await db.syncQueue.add({ table: 'drugs', op: 'upsert', payload: d, createdAt: Date.now() });
    await logAudit('staff', editing === 'new' ? 'drug.create' : 'drug.update', d.name);
    sounds.success();
    setEditing(null);
  }

  async function del(d: Drug) {
    if (!confirm(`Delete ${d.name}? This cannot be undone.`)) return;
    await db.drugs.delete(d.id);
    await db.syncQueue.add({ table: 'drugs', op: 'delete', payload: { id: d.id }, createdAt: Date.now() });
    await logAudit('staff', 'drug.delete', d.name);
  }

  function exportCsv() {
    downloadCSV('vitcare-inventory.csv', (drugs ?? []).map((d) => ({
      name: d.name, generic: d.genericName, strength: d.strength, form: d.dosageForm,
      manufacturer: d.manufacturer, batch: d.batchNumber, expiry: d.expiryDate,
      stock: d.stock, reorder: d.reorderLevel, price_excl: d.unitPrice, tax_rate: d.taxRate,
      category: d.category, barcode: d.barcode,
    })));
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const [head, ...rows] = text.split(/\r?\n/).filter(Boolean);
    const cols = head.split(',').map((c) => c.trim().toLowerCase().replace(/"/g, ''));
    const idx = (n: string) => cols.indexOf(n);
    let added = 0;
    for (const row of rows) {
      const cells = row.match(/("([^"]|"")*"|[^,]*)/g)?.filter((c) => c !== '') ?? [];
      const get = (n: string) => (cells[idx(n)] ?? '').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
      if (!get('name')) continue;
      await db.drugs.put({
        ...EMPTY, id: uid(), updatedAt: Date.now(),
        name: get('name'), genericName: get('generic'), strength: get('strength'),
        dosageForm: get('form') || 'Tablet', manufacturer: get('manufacturer'),
        batchNumber: get('batch'), expiryDate: get('expiry'),
        stock: Number(get('stock')) || 0, reorderLevel: Number(get('reorder')) || 10,
        unitPrice: Number(get('price_excl')) || 0, taxRate: Number(get('tax_rate')) || 0,
        category: get('category') || 'General', barcode: get('barcode'),
      });
      added += 1;
    }
    await logAudit('staff', 'drug.import', `${added} rows from CSV`);
    alert(`Imported ${added} products.`);
  }

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold mr-auto">Inventory</h1>
        <button className="btn-ghost border border-mint-deep text-sm" onClick={exportCsv}><Download className="w-4 h-4" /> Export CSV</button>
        <button className="btn-ghost border border-mint-deep text-sm" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> Import CSV</button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden"
          onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])} />
        <button className="btn-leaf text-sm" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add product</button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
          <input className="input pl-9" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {(['all', 'low', 'expiring'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`chip border ${filter === f ? 'bg-fir text-white border-fir' : 'bg-white text-fir border-mint-deep'}`}>
            {f === 'all' ? 'All' : f === 'low' ? 'Low stock' : 'Expiring ≤90d'}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink/50 border-b border-mint-deep">
              <th className="p-3">Product</th><th className="p-3">Batch / Expiry</th>
              <th className="p-3 text-right">Stock</th><th className="p-3 text-right">Price (excl)</th>
              <th className="p-3 text-right">VAT</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {(drugs ?? []).map((d) => {
              const days = daysUntil(d.expiryDate);
              return (
                <tr key={d.id} className="border-b border-mint/60 hover:bg-mint/40">
                  <td className="p-3">
                    <p className="font-semibold">{d.name} <span className="text-ink/40 font-normal">{d.strength}</span></p>
                    <p className="text-xs text-ink/50">{d.genericName} · {d.dosageForm} · {d.category}</p>
                  </td>
                  <td className="p-3 text-xs">
                    <p className="font-mono">{d.batchNumber}</p>
                    <p className={days <= 90 ? 'text-red-600 font-semibold' : 'text-ink/50'}>{d.expiryDate} ({days}d)</p>
                  </td>
                  <td className="p-3 text-right">
                    <span className={`font-mono font-bold ${d.stock <= d.reorderLevel ? 'text-amber-600' : ''}`}>{d.stock}</span>
                    <p className="text-[10px] text-ink/40">reorder @ {d.reorderLevel}</p>
                  </td>
                  <td className="p-3 text-right font-mono">{KES(d.unitPrice)}</td>
                  <td className="p-3 text-right font-mono">{(d.taxRate * 100).toFixed(0)}%</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <button className="p-2 rounded-lg hover:bg-mint" title="Receive stock" onClick={() => setRestock(d)}><PackagePlus className="w-4 h-4 text-fir" /></button>
                      <button className="p-2 rounded-lg hover:bg-mint" title="Edit" onClick={() => setEditing(d)}><Pencil className="w-4 h-4 text-ink/60" /></button>
                      <button className="p-2 rounded-lg hover:bg-red-50" title="Delete" onClick={() => void del(d)}><Trash2 className="w-4 h-4 text-red-500" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(drugs ?? []).length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-ink/40">No products match. Add one to get started.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {editing && <DrugModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={save} />}
        {restock && <RestockModal drug={restock} onClose={() => setRestock(null)} />}
      </AnimatePresence>
    </div>
  );
}

function DrugModal({ initial, onClose, onSave }: { initial: Drug | null; onClose: () => void; onSave: (d: Drug) => void }) {
  const [f, setF] = useState<Drug>(initial ?? { ...EMPTY, id: uid(), updatedAt: Date.now() });
  const set = (k: keyof Drug, v: string | number) => setF({ ...f, [k]: v });
  const num = (v: string) => Number(v) || 0;

  return (
    <Modal onClose={onClose} title={initial ? `Edit ${initial.name}` : 'Add product'}>
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
        <input className="input col-span-2" placeholder="Brand name *" required value={f.name} onChange={(e) => set('name', e.target.value)} />
        <input className="input" placeholder="Generic name" value={f.genericName} onChange={(e) => set('genericName', e.target.value)} />
        <input className="input" placeholder="Strength (500 mg)" value={f.strength} onChange={(e) => set('strength', e.target.value)} />
        <select className="input" value={f.dosageForm} onChange={(e) => set('dosageForm', e.target.value)}>
          {['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Inhaler', 'Sachet', 'Spray', 'Device', 'Box'].map((o) => <option key={o}>{o}</option>)}
        </select>
        <input className="input" placeholder="Manufacturer" value={f.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
        <input className="input" placeholder="Batch number" value={f.batchNumber} onChange={(e) => set('batchNumber', e.target.value)} />
        <label className="text-xs text-ink/50 col-span-1">Expiry date
          <input className="input mt-1" type="date" required value={f.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
        </label>
        <label className="text-xs text-ink/50">Unit price, KES excl. VAT
          <input className="input mt-1 font-mono" inputMode="decimal" value={f.unitPrice} onChange={(e) => set('unitPrice', num(e.target.value))} />
        </label>
        <label className="text-xs text-ink/50">Opening stock
          <input className="input mt-1 font-mono" inputMode="numeric" value={f.stock} onChange={(e) => set('stock', num(e.target.value))} />
        </label>
        <label className="text-xs text-ink/50">Reorder level
          <input className="input mt-1 font-mono" inputMode="numeric" value={f.reorderLevel} onChange={(e) => set('reorderLevel', num(e.target.value))} />
        </label>
        <select className="input" value={f.taxRate} onChange={(e) => set('taxRate', Number(e.target.value))}>
          <option value={0}>VAT 0% (zero-rated medicine)</option>
          <option value={0.16}>VAT 16% (standard)</option>
        </select>
        <input className="input" placeholder="Category" value={f.category} onChange={(e) => set('category', e.target.value)} />
        <input className="input col-span-2" placeholder="Barcode / QR" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} />
        <button className="btn-primary col-span-2">Save product</button>
      </form>
    </Modal>
  );
}

function RestockModal({ drug, onClose }: { drug: Drug; onClose: () => void }) {
  const [qty, setQty] = useState('');
  const [mode, setMode] = useState<'purchase' | 'return' | 'adjustment'>('purchase');

  async function apply() {
    const n = Number(qty);
    if (!Number.isFinite(n) || n === 0) return;
    const delta = mode === 'adjustment' ? n : Math.abs(n) * (mode === 'purchase' ? 1 : 1);
    const next = Math.max(0, drug.stock + delta);
    await db.drugs.update(drug.id, { stock: next, updatedAt: Date.now() });
    const updated = await db.drugs.get(drug.id);
    if (updated) await db.syncQueue.add({ table: 'drugs', op: 'upsert', payload: updated, createdAt: Date.now() });
    await logAudit('staff', `stock.${mode}`, `${drug.name}: ${delta > 0 ? '+' : ''}${delta} → ${next}`);
    sounds.success();
    onClose();
  }

  return (
    <Modal onClose={onClose} title={`Receive stock — ${drug.name}`}>
      <div className="space-y-3">
        <div className="flex gap-2">
          {(['purchase', 'return', 'adjustment'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`chip border capitalize ${mode === m ? 'bg-fir text-white border-fir' : 'bg-white text-fir border-mint-deep'}`}>{m}</button>
          ))}
        </div>
        <p className="text-sm text-ink/50">Current stock: <span className="font-mono font-bold text-ink">{drug.stock}</span></p>
        <input className="input font-mono" inputMode="numeric" autoFocus
          placeholder={mode === 'adjustment' ? 'Signed quantity, e.g. -3' : 'Quantity received'}
          value={qty} onChange={(e) => setQty(e.target.value.replace(/[^-\d]/g, ''))} />
        <button className="btn-primary w-full" onClick={() => void apply()}>Apply</button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
        className="bg-white dark:bg-[#0c1f18] rounded-2xl p-6 w-full max-w-lg shadow-lift max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-mint"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
