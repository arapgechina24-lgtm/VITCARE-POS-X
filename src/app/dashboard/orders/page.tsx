'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Inbox, Phone } from 'lucide-react';
import { db, logAudit } from '@/lib/db';
import { KES } from '@/lib/utils';
import { sounds } from '@/lib/sounds';
import type { OnlineOrder } from '@/lib/types';

/**
 * Online orders queue. Orders placed on the customer shop land here instantly:
 * over Supabase Realtime when connected, or straight into IndexedDB in demo
 * mode (same device). Fulfilling an order decrements stock like a sale.
 */
export default function OrdersPage() {
  const orders = useLiveQuery(() => db.orders.orderBy('createdAt').reverse().toArray(), [], []);

  async function setStatus(o: OnlineOrder, status: 'fulfilled' | 'rejected') {
    await db.orders.update(o.id, { status });
    if (status === 'fulfilled') {
      for (const l of o.lines) {
        const d = await db.drugs.get(l.drugId);
        if (d) await db.drugs.update(d.id, { stock: Math.max(0, d.stock - l.qty), updatedAt: Date.now() });
      }
      sounds.success();
    }
    const updated = await db.orders.get(o.id);
    if (updated) await db.syncQueue.add({ table: 'orders', op: 'upsert', payload: updated, createdAt: Date.now() });
    await logAudit('staff', `order.${status}`, `${o.id.slice(0, 8)} · ${o.customerName}`);
  }

  const groups: Array<{ key: OnlineOrder['status']; label: string }> = [
    { key: 'new', label: 'New' },
    { key: 'fulfilled', label: 'Fulfilled' },
    { key: 'rejected', label: 'Rejected' },
  ];

  return (
    <div className="space-y-6 animate-rise">
      <h1 className="text-2xl font-bold">Online orders</h1>
      {groups.map(({ key, label }) => {
        const list = (orders ?? []).filter((o) => o.status === key);
        return (
          <section key={key}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50 mb-2">
              {label} ({list.length})
            </h2>
            {list.length === 0 ? (
              key === 'new' ? (
                <div className="card p-8 text-center text-ink/40 text-sm">
                  <Inbox className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No new orders. Orders from the customer shop appear here in real time.
                </div>
              ) : null
            ) : (
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                {list.map((o) => (
                  <motion.div key={o.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{o.customerName || 'Customer'}</p>
                      <span className="text-xs text-ink/40">{new Date(o.createdAt).toLocaleTimeString('en-KE')}</span>
                    </div>
                    <a href={`tel:${o.customerPhone}`} className="text-xs text-fir flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" /> {o.customerPhone}
                    </a>
                    <ul className="mt-2 text-sm space-y-0.5">
                      {o.lines.map((l) => (
                        <li key={l.drugId} className="flex justify-between">
                          <span className="truncate">{l.qty} × {l.name}</span>
                          <span className="font-mono">{KES(l.unitPrice * (1 + l.taxRate) * l.qty)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 flex justify-between font-bold border-t border-dashed border-mint-deep pt-2">
                      <span>Total</span><span className="font-mono">{KES(o.total)}</span>
                    </p>
                    {o.status === 'new' && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button className="btn-leaf text-sm" onClick={() => void setStatus(o, 'fulfilled')}>
                          <CheckCircle2 className="w-4 h-4" /> Fulfil
                        </button>
                        <button className="btn-ghost border border-red-200 text-red-600 text-sm" onClick={() => void setStatus(o, 'rejected')}>
                          <XCircle className="w-4 h-4" /> Reject
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
