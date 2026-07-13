'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Undo2, X, Receipt as ReceiptIcon } from 'lucide-react';
import { db, logAudit } from '@/lib/db';
import { KES, lineTotals } from '@/lib/utils';
import { sounds } from '@/lib/sounds';
import { CAN, useRole } from '@/lib/role';
import type { CartLine, RefundRecord, Sale } from '@/lib/types';

/** How much of a given drug on this sale has already been refunded. */
function refundedQtyFor(sale: Sale, drugId: string) {
  return (sale.refunds ?? []).reduce((a, r) => a + (r.lines.find((l) => l.drugId === drugId)?.qty ?? 0), 0);
}

export default function SalesPage() {
  const role = useRole();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Sale | null>(null);

  const sales = useLiveQuery(() => db.sales.orderBy('createdAt').reverse().limit(200).toArray(), [], []);
  const visible = (sales ?? []).filter((s) =>
    !q.trim() || [s.invoiceNo, s.customerName, s.customerPhone].some((f) => (f ?? '').toLowerCase().includes(q.toLowerCase())));

  if (!CAN.processRefunds(role)) {
    return (
      <div className="animate-rise">
        <h1 className="text-2xl font-bold">Sales &amp; refunds</h1>
        <p className="mt-3 text-sm text-ink/50">Only administrators and pharmacists can view sales history and process refunds.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-rise">
      <h1 className="text-2xl font-bold">Sales &amp; refunds</h1>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
        <input className="input pl-9" placeholder="Search invoice, customer, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink/50 border-b border-mint-deep">
              <th className="p-3">Invoice</th><th className="p-3">Customer</th><th className="p-3">Date</th>
              <th className="p-3 text-right">Total</th><th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id} className="border-b border-mint/60 hover:bg-mint/40">
                <td className="p-3 font-mono">{s.invoiceNo}</td>
                <td className="p-3">{s.customerName || 'Walk-in'}</td>
                <td className="p-3 text-xs">{new Date(s.createdAt).toLocaleString('en-KE')}</td>
                <td className="p-3 text-right font-mono">{KES(s.total)}</td>
                <td className="p-3">
                  <span className={`chip ${
                    s.status === 'paid' ? 'bg-mint text-fir'
                      : s.status === 'refunded' ? 'bg-red-50 text-red-600'
                      : s.status === 'partially_refunded' ? 'bg-amber-50 text-amber-700'
                      : 'bg-ink/5 text-ink/60'
                  }`}>
                    {s.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="p-3 text-right">
                  {(s.status === 'paid' || s.status === 'partially_refunded') && (
                    <button className="btn-ghost border border-mint-deep text-xs" onClick={() => setSelected(s)}>
                      <Undo2 className="w-3.5 h-3.5" /> Refund
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-ink/40">No sales match.</td></tr>}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {selected && <RefundModal sale={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}

function RefundModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const lines = sale.lines
    .map((l) => ({ ...l, alreadyRefunded: refundedQtyFor(sale, l.drugId) }))
    .filter((l) => l.alreadyRefunded < l.qty);

  async function submit() {
    const refundLines: CartLine[] = lines
      .map((l) => ({ ...l, qty: Math.min(qtys[l.drugId] ?? 0, l.qty - l.alreadyRefunded) }))
      .filter((l) => l.qty > 0);
    if (!refundLines.length) return;
    setBusy(true);

    // Prorate any sale-level discount into the refund amount.
    const originalGross = sale.lines.reduce((a, l) => a + lineTotals(l).incl, 0);
    const scale = originalGross > 0 ? sale.total / originalGross : 1;
    const amount = refundLines.reduce((a, l) => a + lineTotals(l).incl, 0) * scale;

    const record: RefundRecord = { id: `${Date.now()}`, at: Date.now(), lines: refundLines, amount, reason: reason || undefined };
    const allRefunds = [...(sale.refunds ?? []), record];
    const totalRefundedQty = sale.lines.reduce((a, l) => a + refundedQtyFor({ ...sale, refunds: allRefunds }, l.drugId), 0);
    const totalQty = sale.lines.reduce((a, l) => a + l.qty, 0);
    const status = totalRefundedQty >= totalQty ? 'refunded' : 'partially_refunded';

    await db.transaction('rw', db.sales, db.drugs, db.syncQueue, async () => {
      await db.sales.update(sale.id, { refunds: allRefunds, status });
      for (const l of refundLines) {
        const d = await db.drugs.get(l.drugId);
        if (d) await db.drugs.update(l.drugId, { stock: d.stock + l.qty, updatedAt: Date.now() });
      }
      const updated = await db.sales.get(sale.id);
      if (updated) await db.syncQueue.add({ table: 'sales', op: 'upsert', payload: updated, createdAt: Date.now() });
    });
    await logAudit('staff', 'sale.refund', `${sale.invoiceNo}: ${KES(amount)}${reason ? ` · ${reason}` : ''}`);
    sounds.success();
    setBusy(false);
    onClose();
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
        className="bg-white dark:bg-[#0c2233] rounded-2xl p-6 w-full max-w-lg shadow-lift max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg flex items-center gap-2"><ReceiptIcon className="w-4 h-4" /> Refund — {sale.invoiceNo}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-mint"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2">
          {lines.map((l) => {
            const max = l.qty - l.alreadyRefunded;
            return (
              <div key={l.drugId} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">
                  {l.name} <span className="text-ink/40 text-xs">(sold {l.qty}{l.alreadyRefunded ? `, refunded ${l.alreadyRefunded}` : ''})</span>
                </span>
                <input className="input w-20 text-right font-mono" inputMode="numeric" placeholder="0"
                  value={qtys[l.drugId] ?? ''}
                  onChange={(e) => {
                    const n = Math.max(0, Math.min(max, Number(e.target.value.replace(/\D/g, '')) || 0));
                    setQtys((q) => ({ ...q, [l.drugId]: n }));
                  }} />
                <button className="text-xs text-fir" onClick={() => setQtys((q) => ({ ...q, [l.drugId]: max }))}>All</button>
              </div>
            );
          })}
          {!lines.length && <p className="text-sm text-ink/40">Everything on this sale has already been refunded.</p>}
          <input className="input mt-2" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn-primary w-full mt-2" disabled={busy || !lines.length} onClick={() => void submit()}>
            Process refund
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
