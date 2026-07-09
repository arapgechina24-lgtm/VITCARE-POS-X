'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileText } from 'lucide-react';
import { db } from '@/lib/db';
import { downloadCSV, KES, daysUntil } from '@/lib/utils';

type Range = 'today' | '7d' | '30d' | 'all';
const RANGES: Array<{ key: Range; label: string }> = [
  { key: 'today', label: 'Today' }, { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' }, { key: 'all', label: 'All time' },
];

export default function ReportsPage() {
  const [range, setRange] = useState<Range>('7d');

  const from = (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (range === 'today') return d.getTime();
    if (range === '7d') return d.getTime() - 6 * 86_400_000;
    if (range === '30d') return d.getTime() - 29 * 86_400_000;
    return 0;
  })();

  const sales = useLiveQuery(
    () => db.sales.where('createdAt').aboveOrEqual(from).and((s) => s.status === 'paid').toArray(),
    [from], [],
  );
  const drugs = useLiveQuery(() => db.drugs.toArray(), [], []);
  const audit = useLiveQuery(() => db.audit.orderBy('at').reverse().limit(30).toArray(), [], []);

  const revenue = (sales ?? []).reduce((a, s) => a + s.total, 0);
  const tax = (sales ?? []).reduce((a, s) => a + s.taxTotal, 0);
  const byMethod = (sales ?? []).reduce<Record<string, number>>((m, s) => {
    m[s.method] = (m[s.method] ?? 0) + s.total; return m;
  }, {});

  const topDrugs = Object.values(
    (sales ?? []).flatMap((s) => s.lines).reduce<Record<string, { name: string; qty: number; rev: number }>>((m, l) => {
      const cur = m[l.drugId] ?? { name: l.name, qty: 0, rev: 0 };
      cur.qty += l.qty;
      cur.rev += l.unitPrice * (1 + l.taxRate) * l.qty;
      m[l.drugId] = cur;
      return m;
    }, {}),
  ).sort((a, b) => b.rev - a.rev).slice(0, 8);

  const inventoryValue = (drugs ?? []).reduce((a, d) => a + d.stock * d.unitPrice, 0);
  const expiryReport = (drugs ?? []).filter((d) => daysUntil(d.expiryDate) <= 120)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold mr-auto">Reports &amp; analytics</h1>
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setRange(r.key)}
            className={`chip border ${range === r.key ? 'bg-fir text-white border-fir' : 'bg-white text-fir border-mint-deep'}`}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Revenue (incl. VAT)" value={KES(revenue)} />
        <Stat label="VAT collected" value={KES(tax)} />
        <Stat label="Transactions" value={String((sales ?? []).length)} />
        <Stat label="Inventory value (excl.)" value={KES(inventoryValue)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Top sellers</p>
            <button className="btn-ghost text-xs" onClick={() =>
              downloadCSV('top-sellers.csv', topDrugs.map((t) => ({ product: t.name, units: t.qty, revenue: t.rev.toFixed(2) })))}>
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {topDrugs.map((t, i) => (
              <li key={t.name} className="flex items-center gap-3">
                <span className="w-5 text-ink/40 font-mono text-xs">{i + 1}</span>
                <span className="flex-1 truncate">{t.name}</span>
                <span className="text-ink/50">{t.qty} u</span>
                <span className="font-mono w-28 text-right">{KES(t.rev)}</span>
              </li>
            ))}
            {!topDrugs.length && <li className="text-ink/40">No sales in this period yet.</li>}
          </ul>
          <div className="mt-4 border-t border-dashed border-mint-deep pt-3 text-sm space-y-1">
            {Object.entries(byMethod).map(([m, v]) => (
              <p key={m} className="flex justify-between"><span className="capitalize">{m}</span><span className="font-mono">{KES(v)}</span></p>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Expiry report (≤120 days)</p>
            <button className="btn-ghost text-xs" onClick={() =>
              downloadCSV('expiry-report.csv', expiryReport.map((d) => ({ product: d.name, batch: d.batchNumber, expiry: d.expiryDate, stock: d.stock, value: (d.stock * d.unitPrice).toFixed(2) })))}>
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {expiryReport.slice(0, 8).map((d) => (
              <li key={d.id} className="flex justify-between gap-2">
                <span className="truncate">{d.name} <span className="text-ink/40 font-mono text-xs">{d.batchNumber}</span></span>
                <span className={`font-mono ${daysUntil(d.expiryDate) <= 60 ? 'text-red-600' : 'text-amber-600'}`}>{d.expiryDate}</span>
              </li>
            ))}
            {!expiryReport.length && <li className="text-ink/40">Nothing expiring within 120 days.</li>}
          </ul>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <p className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> Transactions &amp; audit trail</p>
          <button className="btn-ghost text-xs" onClick={() =>
            downloadCSV('sales.csv', (sales ?? []).map((s) => ({
              invoice: s.invoiceNo, date: new Date(s.createdAt).toISOString(),
              method: s.method, subtotal: s.subtotal.toFixed(2), vat: s.taxTotal.toFixed(2), total: s.total.toFixed(2),
            })))}>
            <Download className="w-3.5 h-3.5" /> Sales CSV
          </button>
        </div>
        <ul className="mt-3 space-y-1.5 text-xs font-mono text-ink/60 max-h-64 overflow-y-auto">
          {(audit ?? []).map((a) => (
            <li key={a.id}>
              <span className="text-ink/40">{new Date(a.at).toLocaleString('en-KE')}</span>{' '}
              <span className="text-fir font-semibold">{a.action}</span> — {a.detail}
            </li>
          ))}
          {!(audit ?? []).length && <li className="text-ink/40 font-body">Activity will appear here.</li>}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{label}</p>
      <p className="mt-1 text-xl font-bold font-mono">{value}</p>
    </div>
  );
}
