'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Search, Pencil, Trash2, X, Phone } from 'lucide-react';
import { db, logAudit, uid } from '@/lib/db';
import { KES } from '@/lib/utils';
import { CAN, useRole } from '@/lib/role';
import type { Customer } from '@/lib/types';

const EMPTY: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', phone: '', email: '', kraPin: '', notes: '', loyaltyPoints: 0,
};

export default function CustomersPage() {
  const role = useRole();
  const canWrite = CAN.manageDirectory(role);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);

  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), [], []);
  const sales = useLiveQuery(() => db.sales.where('status').anyOf('paid', 'partially_refunded').toArray(), [], []);

  const visible = (customers ?? []).filter((c) =>
    !q.trim() || [c.name, c.phone, c.email ?? ''].some((f) => f.toLowerCase().includes(q.toLowerCase())));

  /** Purchase history is derived by matching phone — sales aren't forced to reference a customer record. */
  function statsFor(c: Customer) {
    const matches = (sales ?? []).filter((s) => s.customerPhone && s.customerPhone === c.phone);
    return { visits: matches.length, spent: matches.reduce((a, s) => a + s.total, 0) };
  }

  async function save(c: Customer) {
    if (!canWrite) return;
    c.updatedAt = Date.now();
    await db.customers.put(c);
    await db.syncQueue.add({ table: 'customers', op: 'upsert', payload: c, createdAt: Date.now() });
    await logAudit('staff', editing === 'new' ? 'customer.create' : 'customer.update', c.name);
    setEditing(null);
  }

  async function del(c: Customer) {
    if (!canWrite) return;
    if (!confirm(`Delete customer ${c.name}?`)) return;
    await db.customers.delete(c.id);
    await db.syncQueue.add({ table: 'customers', op: 'delete', payload: { id: c.id }, createdAt: Date.now() });
    await logAudit('staff', 'customer.delete', c.name);
  }

  return (
    <div className="space-y-4 animate-rise">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold mr-auto">Customers</h1>
        {canWrite && (
          <button className="btn-leaf text-sm" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add customer</button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
        <input className="input pl-9" placeholder="Search name, phone, email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink/50 border-b border-mint-deep">
              <th className="p-3">Customer</th><th className="p-3">Contact</th>
              <th className="p-3 text-right">Visits</th><th className="p-3 text-right">Lifetime spend</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const s = statsFor(c);
              return (
                <tr key={c.id} className="border-b border-mint/60 hover:bg-mint/40">
                  <td className="p-3">
                    <p className="font-semibold">{c.name}</p>
                    {c.kraPin && <p className="text-xs text-ink/50 font-mono">{c.kraPin}</p>}
                  </td>
                  <td className="p-3 text-xs">
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 text-fir"><Phone className="w-3 h-3" /> {c.phone}</a>
                    {c.email && <p className="text-ink/50">{c.email}</p>}
                  </td>
                  <td className="p-3 text-right font-mono">{s.visits}</td>
                  <td className="p-3 text-right font-mono">{KES(s.spent)}</td>
                  <td className="p-3">
                    {canWrite && (
                      <div className="flex justify-end gap-1">
                        <button className="p-2 rounded-lg hover:bg-mint" title="Edit" onClick={() => setEditing(c)}><Pencil className="w-4 h-4 text-ink/60" /></button>
                        <button className="p-2 rounded-lg hover:bg-red-50" title="Delete" onClick={() => void del(c)}><Trash2 className="w-4 h-4 text-red-500" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-ink/40">No customers yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {editing && (
          <CustomerModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={save} />
        )}
      </AnimatePresence>
    </div>
  );
}

function CustomerModal({ initial, onClose, onSave }: {
  initial: Customer | null; onClose: () => void; onSave: (c: Customer) => void;
}) {
  const [f, setF] = useState<Customer>(initial ?? { ...EMPTY, id: uid(), createdAt: Date.now(), updatedAt: Date.now() });
  const set = <K extends keyof Customer>(k: K, v: Customer[K]) => setF({ ...f, [k]: v });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
        className="bg-white dark:bg-[#0c2233] rounded-2xl p-6 w-full max-w-md shadow-lift" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{initial ? `Edit ${initial.name}` : 'Add customer'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-mint"><X className="w-5 h-5" /></button>
        </div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
          <input className="input" placeholder="Full name *" required value={f.name} onChange={(e) => set('name', e.target.value)} />
          <input className="input" placeholder="Phone (07XX…) *" required value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          <input className="input" placeholder="Email (optional)" type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          <input className="input" placeholder="KRA PIN (optional)" value={f.kraPin ?? ''} onChange={(e) => set('kraPin', e.target.value.toUpperCase())} />
          <textarea className="input" placeholder="Notes — allergies, prescriptions, preferences…" rows={3}
            value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          <button className="btn-primary w-full">Save customer</button>
        </form>
      </motion.div>
    </motion.div>
  );
}
