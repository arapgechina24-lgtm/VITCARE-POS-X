'use client';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'framer-motion';
import { AlertTriangle, CalendarClock, TrendingUp, Receipt, Pill, ArrowRight } from 'lucide-react';
import { db } from '@/lib/db';
import { KES, daysUntil } from '@/lib/utils';

export default function Overview() {
  const drugs = useLiveQuery(() => db.drugs.toArray(), [], []);
  const sales = useLiveQuery(() => db.sales.where('status').equals('paid').toArray(), [], []);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todaySales = (sales ?? []).filter((s) => s.createdAt >= today.getTime());
  const revenueToday = todaySales.reduce((a, s) => a + s.total, 0);
  const taxToday = todaySales.reduce((a, s) => a + s.taxTotal, 0);
  const low = (drugs ?? []).filter((d) => d.stock <= d.reorderLevel);
  const expiring = (drugs ?? []).filter((d) => daysUntil(d.expiryDate) <= 90);
  const stockValue = (drugs ?? []).reduce((a, d) => a + d.stock * d.unitPrice, 0);

  // last 7 days revenue for the mini chart
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i));
    const next = d.getTime() + 86_400_000;
    const rev = (sales ?? []).filter((s) => s.createdAt >= d.getTime() && s.createdAt < next)
      .reduce((a, s) => a + s.total, 0);
    return { label: d.toLocaleDateString('en-KE', { weekday: 'short' }), rev };
  });
  const max = Math.max(...days.map((d) => d.rev), 1);

  const stats = [
    { label: "Today's revenue", value: KES(revenueToday), icon: TrendingUp, sub: `${todaySales.length} sales` },
    { label: 'VAT collected today', value: KES(taxToday), icon: Receipt, sub: 'eTIMS-ready invoices' },
    { label: 'Inventory value', value: KES(stockValue), icon: Pill, sub: `${(drugs ?? []).length} products` },
  ];

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Habari — here&apos;s the counter today</h1>
          <p className="text-sm text-ink/50 dark:text-mint/50">{new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <Link href="/dashboard/pos" className="btn-leaf">New sale <ArrowRight className="w-4 h-4" /></Link>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }} className="card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 dark:text-mint/50">{s.label}</p>
              <s.icon className="w-4 h-4 text-leaf" />
            </div>
            <p className="mt-2 text-2xl font-bold font-mono">{s.value}</p>
            <p className="text-xs text-ink/40 dark:text-mint/40 mt-1">{s.sub}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* 7-day revenue */}
        <div className="card p-5 lg:col-span-2">
          <p className="font-semibold">Revenue — last 7 days</p>
          <div className="mt-4 flex items-end gap-2 h-36">
            {days.map((d) => (
              <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-t-lg bg-leaf/80 transition-all"
                  style={{ height: `${Math.max(4, (d.rev / max) * 100)}%` }}
                  title={KES(d.rev)} />
                <span className="text-[10px] text-ink/50 dark:text-mint/50">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="card p-5 space-y-4">
          <p className="font-semibold">Needs attention</p>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-600">
              <AlertTriangle className="w-4 h-4" /> Low stock ({low.length})
            </p>
            <ul className="mt-1.5 space-y-1 text-sm">
              {low.slice(0, 4).map((d) => (
                <li key={d.id} className="flex justify-between">
                  <span className="truncate">{d.name}</span>
                  <span className="font-mono text-amber-600">{d.stock} left</span>
                </li>
              ))}
              {!low.length && <li className="text-ink/40 text-sm">All good — nothing below reorder level.</li>}
            </ul>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-red-600">
              <CalendarClock className="w-4 h-4" /> Expiring ≤ 90 days ({expiring.length})
            </p>
            <ul className="mt-1.5 space-y-1 text-sm">
              {expiring.slice(0, 4).map((d) => (
                <li key={d.id} className="flex justify-between">
                  <span className="truncate">{d.name}</span>
                  <span className="font-mono text-red-600">{daysUntil(d.expiryDate)} d</span>
                </li>
              ))}
              {!expiring.length && <li className="text-ink/40 text-sm">No near-expiry batches.</li>}
            </ul>
          </div>
          <Link href="/dashboard/inventory" className="btn-ghost w-full text-sm">Open inventory</Link>
        </div>
      </div>
    </div>
  );
}
