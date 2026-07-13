'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Search, Pencil, Trash2, X, Phone, PackageCheck, ClipboardList } from 'lucide-react';
import { db, logAudit, uid } from '@/lib/db';
import { KES } from '@/lib/utils';
import { CAN, useRole } from '@/lib/role';
import type { Drug, PurchaseOrder, PurchaseOrderLine, Supplier } from '@/lib/types';

const EMPTY: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', contactPerson: '', phone: '', email: '', address: '', outstandingBalance: 0, rating: 5,
};

export default function SuppliersPage() {
  const role = useRole();
  const canWrite = CAN.manageDirectory(role);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [newPo, setNewPo] = useState(false);

  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').toArray(), [], []);
  const orders = useLiveQuery(() => db.purchaseOrders.orderBy('createdAt').reverse().toArray(), [], []);

  const visible = (suppliers ?? []).filter((s) =>
    !q.trim() || [s.name, s.phone, s.contactPerson ?? ''].some((f) => f.toLowerCase().includes(q.toLowerCase())));

  async function save(s: Supplier) {
    if (!canWrite) return;
    s.updatedAt = Date.now();
    await db.suppliers.put(s);
    await db.syncQueue.add({ table: 'suppliers', op: 'upsert', payload: s, createdAt: Date.now() });
    await logAudit('staff', editing === 'new' ? 'supplier.create' : 'supplier.update', s.name);
    setEditing(null);
  }

  async function del(s: Supplier) {
    if (!canWrite) return;
    if (!confirm(`Delete supplier ${s.name}?`)) return;
    await db.suppliers.delete(s.id);
    await db.syncQueue.add({ table: 'suppliers', op: 'delete', payload: { id: s.id }, createdAt: Date.now() });
    await logAudit('staff', 'supplier.delete', s.name);
  }

  async function recordPayment(s: Supplier) {
    if (!canWrite) return;
    const raw = prompt(`Record a payment to ${s.name}. Current balance owed: ${KES(s.outstandingBalance)}\nAmount paid (KES):`);
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount <= 0) return;
    const next = Math.max(0, s.outstandingBalance - amount);
    await db.suppliers.update(s.id, { outstandingBalance: next, updatedAt: Date.now() });
    const updated = await db.suppliers.get(s.id);
    if (updated) await db.syncQueue.add({ table: 'suppliers', op: 'upsert', payload: updated, createdAt: Date.now() });
    await logAudit('staff', 'supplier.payment', `${s.name}: -${KES(amount)} → balance ${KES(next)}`);
  }

  async function receivePo(po: PurchaseOrder) {
    if (!canWrite) return;
    await db.transaction('rw', db.purchaseOrders, db.drugs, db.suppliers, db.syncQueue, async () => {
      await db.purchaseOrders.update(po.id, { status: 'received', receivedAt: Date.now() });
      for (const l of po.lines) {
        const d = await db.drugs.get(l.drugId);
        if (d) await db.drugs.update(l.drugId, { stock: d.stock + l.qty, costPrice: l.costPrice, updatedAt: Date.now() });
      }
      const supplier = await db.suppliers.get(po.supplierId);
      if (supplier) {
        const next = supplier.outstandingBalance + po.total;
        await db.suppliers.update(supplier.id, { outstandingBalance: next, updatedAt: Date.now() });
        const updated = await db.suppliers.get(supplier.id);
        if (updated) await db.syncQueue.add({ table: 'suppliers', op: 'upsert', payload: updated, createdAt: Date.now() });
      }
      const updatedPo = await db.purchaseOrders.get(po.id);
      if (updatedPo) await db.syncQueue.add({ table: 'purchaseOrders', op: 'upsert', payload: updatedPo, createdAt: Date.now() });
    });
    await logAudit('staff', 'po.received', `${po.supplierName}: ${po.lines.length} lines, ${KES(po.total)}`);
  }

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold mr-auto">Suppliers</h1>
        {canWrite && (
          <button className="btn-leaf text-sm" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add supplier</button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
        <input className="input pl-9" placeholder="Search name, phone, contact…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink/50 border-b border-mint-deep">
              <th className="p-3">Supplier</th><th className="p-3">Contact</th>
              <th className="p-3 text-right">Rating</th><th className="p-3 text-right">Owed</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id} className="border-b border-mint/60 hover:bg-mint/40">
                <td className="p-3 font-semibold">{s.name}</td>
                <td className="p-3 text-xs">
                  {s.contactPerson && <p>{s.contactPerson}</p>}
                  <a href={`tel:${s.phone}`} className="flex items-center gap-1 text-fir"><Phone className="w-3 h-3" /> {s.phone}</a>
                </td>
                <td className="p-3 text-right">{'★'.repeat(s.rating ?? 0)}{'☆'.repeat(5 - (s.rating ?? 0))}</td>
                <td className={`p-3 text-right font-mono ${s.outstandingBalance > 0 ? 'text-amber-600' : ''}`}>{KES(s.outstandingBalance)}</td>
                <td className="p-3">
                  {canWrite && (
                    <div className="flex justify-end gap-1">
                      {s.outstandingBalance > 0 && (
                        <button className="btn-ghost border border-mint-deep text-xs" onClick={() => void recordPayment(s)}>Record payment</button>
                      )}
                      <button className="p-2 rounded-lg hover:bg-mint" title="Edit" onClick={() => setEditing(s)}><Pencil className="w-4 h-4 text-ink/60" /></button>
                      <button className="p-2 rounded-lg hover:bg-red-50" title="Delete" onClick={() => void del(s)}><Trash2 className="w-4 h-4 text-red-500" /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-ink/40">No suppliers yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold mr-auto flex items-center gap-2"><ClipboardList className="w-4 h-4" /> Purchase orders</h2>
        {canWrite && (suppliers ?? []).length > 0 && (
          <button className="btn-ghost border border-mint-deep text-sm" onClick={() => setNewPo(true)}><Plus className="w-4 h-4" /> New PO</button>
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink/50 border-b border-mint-deep">
              <th className="p-3">Supplier</th><th className="p-3">Lines</th><th className="p-3 text-right">Total</th>
              <th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {(orders ?? []).map((po) => (
              <tr key={po.id} className="border-b border-mint/60 hover:bg-mint/40">
                <td className="p-3">{po.supplierName}</td>
                <td className="p-3 text-xs text-ink/60">{po.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</td>
                <td className="p-3 text-right font-mono">{KES(po.total)}</td>
                <td className="p-3">
                  <span className={`chip ${po.status === 'received' ? 'bg-mint text-fir' : po.status === 'cancelled' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                    {po.status}
                  </span>
                </td>
                <td className="p-3 text-right">
                  {canWrite && po.status === 'pending' && (
                    <button className="btn-ghost border border-mint-deep text-xs" onClick={() => void receivePo(po)}>
                      <PackageCheck className="w-3.5 h-3.5" /> Receive
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {(orders ?? []).length === 0 && <tr><td colSpan={5} className="p-8 text-center text-ink/40">No purchase orders yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {editing && <SupplierModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={save} />}
        {newPo && <PoModal suppliers={suppliers ?? []} onClose={() => setNewPo(false)} />}
      </AnimatePresence>
    </div>
  );
}

function SupplierModal({ initial, onClose, onSave }: {
  initial: Supplier | null; onClose: () => void; onSave: (s: Supplier) => void;
}) {
  const [f, setF] = useState<Supplier>(initial ?? { ...EMPTY, id: uid(), createdAt: Date.now(), updatedAt: Date.now() });
  const set = <K extends keyof Supplier>(k: K, v: Supplier[K]) => setF({ ...f, [k]: v });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
        className="bg-white dark:bg-[#0c2233] rounded-2xl p-6 w-full max-w-md shadow-lift" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{initial ? `Edit ${initial.name}` : 'Add supplier'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-mint"><X className="w-5 h-5" /></button>
        </div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
          <input className="input" placeholder="Supplier name *" required value={f.name} onChange={(e) => set('name', e.target.value)} />
          <input className="input" placeholder="Contact person" value={f.contactPerson ?? ''} onChange={(e) => set('contactPerson', e.target.value)} />
          <input className="input" placeholder="Phone *" required value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          <input className="input" placeholder="Email" type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          <input className="input" placeholder="Address" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          <label className="block text-xs text-ink/50">Rating (1-5)
            <select className="input mt-1" value={f.rating ?? 5} onChange={(e) => set('rating', Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn-primary w-full">Save supplier</button>
        </form>
      </motion.div>
    </motion.div>
  );
}

function PoModal({ suppliers, onClose }: { suppliers: Supplier[]; onClose: () => void }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const drugs = useLiveQuery(async () => {
    const all = await db.drugs.orderBy('name').toArray();
    const term = q.trim().toLowerCase();
    return term ? all.filter((d) => d.name.toLowerCase().includes(term)).slice(0, 8) : all.slice(0, 8);
  }, [q], []);

  function addLine(d: Drug) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.drugId === d.id);
      if (i >= 0) { const next = [...ls]; next[i] = { ...next[i], qty: next[i].qty + 1 }; return next; }
      return [...ls, { drugId: d.id, name: d.name, qty: 1, costPrice: d.costPrice }];
    });
  }
  const total = lines.reduce((a, l) => a + l.qty * l.costPrice, 0);

  async function submit() {
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier || !lines.length) return;
    const po: PurchaseOrder = {
      id: uid(), supplierId: supplier.id, supplierName: supplier.name,
      lines, total, status: 'pending', createdAt: Date.now(),
    };
    await db.purchaseOrders.add(po);
    await db.syncQueue.add({ table: 'purchaseOrders', op: 'upsert', payload: po, createdAt: Date.now() });
    await logAudit('staff', 'po.create', `${supplier.name}: ${lines.length} lines, ${KES(total)}`);
    onClose();
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
        className="bg-white dark:bg-[#0c2233] rounded-2xl p-6 w-full max-w-lg shadow-lift max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">New purchase order</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-mint"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
            <input className="input pl-9" placeholder="Search products to add…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(drugs ?? []).map((d) => (
              <button key={d.id} type="button" className="chip bg-mint text-fir border border-mint-deep" onClick={() => addLine(d)}>
                <Plus className="w-3 h-3" /> {d.name}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            {lines.map((l) => (
              <div key={l.drugId} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{l.name}</span>
                <input className="input w-16 text-right font-mono" inputMode="numeric" value={l.qty}
                  onChange={(e) => setLines((ls) => ls.map((x) => x.drugId === l.drugId ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} />
                <input className="input w-24 text-right font-mono" inputMode="decimal" value={l.costPrice}
                  onChange={(e) => setLines((ls) => ls.map((x) => x.drugId === l.drugId ? { ...x, costPrice: Number(e.target.value) || 0 } : x))} />
                <button type="button" className="text-ink/30 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.drugId !== l.drugId))}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {!lines.length && <p className="text-sm text-ink/40 py-2">Add products above to build the order.</p>}
          </div>

          <p className="flex justify-between font-bold border-t border-dashed border-mint-deep pt-2"><span>Total</span><span className="font-mono">{KES(total)}</span></p>
          <button className="btn-primary w-full" disabled={!lines.length || !supplierId} onClick={() => void submit()}>Create order</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
