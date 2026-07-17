'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileText, Printer, FileSpreadsheet } from 'lucide-react';
import { db } from '@/lib/db';
import { downloadCSV, downloadXLS, printReport, escapeHtml, KES, daysUntil } from '@/lib/utils';
import { CAN, useRole } from '@/lib/role';
import type { Sale } from '@/lib/types';

type Range = 'today' | '7d' | '30d' | 'all';
const RANGES: Array<{ key: Range; label: string }> = [
  { key: 'today', label: 'Today' }, { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' }, { key: 'all', label: 'All time' },
];

export default function ReportsPage() {
  const role = useRole();
  const [range, setRange] = useState<Range>('7d');

  const from = (() => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (range === 'today') return d.getTime();
    if (range === '7d') return d.getTime() - 6 * 86_400_000;
    if (range === '30d') return d.getTime() - 29 * 86_400_000;
    return 0;
  })();

  const sales = useLiveQuery(
    () => db.sales.where('createdAt').aboveOrEqual(from)
      .and((s) => s.status === 'paid' || s.status === 'partially_refunded' || s.status === 'refunded').toArray(),
    [from], [],
  );
  const drugs = useLiveQuery(() => db.drugs.toArray(), [], []);
  const audit = useLiveQuery(() => db.audit.orderBy('at').reverse().limit(30).toArray(), [], []);
  const purchaseOrders = useLiveQuery(() => db.purchaseOrders.toArray(), [], []);
  const claims = useLiveQuery(() => db.insuranceClaims.toArray(), [], []);

  /** Nets out refunds. The excl./VAT split is prorated by the post-refund ratio
   *  (an approximation when a refund only covers some lines); COGS below is exact
   *  since refund records keep the original per-line cost price. */
  function netOf(s: Sale) {
    const refunded = (s.refunds ?? []).reduce((a, r) => a + r.amount, 0);
    const ratio = s.total > 0 ? Math.max(0, (s.total - refunded) / s.total) : 0;
    return { total: s.total - refunded, subtotal: s.subtotal * ratio, taxTotal: s.taxTotal * ratio };
  }

  const revenue = (sales ?? []).reduce((a, s) => a + netOf(s).total, 0);
  const tax = (sales ?? []).reduce((a, s) => a + netOf(s).taxTotal, 0);
  const netRevenueExclTax = (sales ?? []).reduce((a, s) => a + netOf(s).subtotal, 0);
  const cogs = (sales ?? []).flatMap((s) => s.lines).reduce((a, l) => a + (l.costPrice ?? 0) * l.qty, 0)
    - (sales ?? []).flatMap((s) => s.refunds ?? []).flatMap((r) => r.lines).reduce((a, l) => a + (l.costPrice ?? 0) * l.qty, 0);
  const grossProfit = netRevenueExclTax - cogs;

  const byMethod = (sales ?? []).reduce<Record<string, number>>((m, s) => {
    m[s.method] = (m[s.method] ?? 0) + netOf(s).total; return m;
  }, {});
  const cashOut = (purchaseOrders ?? [])
    .filter((po) => po.status === 'received' && (po.receivedAt ?? 0) >= from)
    .reduce((a, po) => a + po.total, 0);
  // Balance-sheet figure (not period-filtered) — money billed to payers, not yet received as cash.
  const insuranceReceivable = (claims ?? [])
    .filter((c) => c.status !== 'paid' && c.status !== 'rejected')
    .reduce((a, c) => a + (c.approvedAmount ?? c.claimAmount), 0);

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

  if (!CAN.viewReports(role)) {
    return (
      <div className="animate-rise">
        <h1 className="text-2xl font-bold">Reports &amp; analytics</h1>
        <p className="mt-3 text-sm text-ink/50">Only administrators and pharmacists can view financial reports.</p>
      </div>
    );
  }

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
        <button className="btn-ghost border border-mint-deep text-sm" onClick={() => printReport(
          `Vitcare POS — Report (${RANGES.find((r) => r.key === range)?.label})`,
          `<h2>Summary</h2>
           <table><tbody>
             <tr><td>Revenue (incl. VAT)</td><td class="right">${KES(revenue)}</td></tr>
             <tr><td>VAT collected</td><td class="right">${KES(tax)}</td></tr>
             <tr><td>Gross profit</td><td class="right">${KES(grossProfit)}</td></tr>
             <tr><td>Transactions</td><td class="right">${(sales ?? []).length}</td></tr>
             <tr><td>Inventory value (excl.)</td><td class="right">${KES(inventoryValue)}</td></tr>
             <tr><td>Insurance receivables (outstanding)</td><td class="right">${KES(insuranceReceivable)}</td></tr>
           </tbody></table>
           <h2>Top sellers</h2>
           <table><thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead><tbody>
             ${topDrugs.map((t) => `<tr><td>${escapeHtml(t.name)}</td><td>${t.qty}</td><td class="right">${KES(t.rev)}</td></tr>`).join('')}
           </tbody></table>
           <h2>Expiry report (&le;120 days)</h2>
           <table><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Stock</th></tr></thead><tbody>
             ${expiryReport.map((d) => `<tr><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.batchNumber)}</td><td>${escapeHtml(d.expiryDate)}</td><td>${d.stock}</td></tr>`).join('')}
           </tbody></table>`,
        )}>
          <Printer className="w-4 h-4" /> Print / PDF
        </button>
        <button className="btn-ghost border border-mint-deep text-sm" onClick={() => downloadXLS('vitcare-report.xls', [
          { title: 'Sales', rows: (sales ?? []).map((s) => ({ invoice: s.invoiceNo, date: new Date(s.createdAt).toISOString(), method: s.method, subtotal: s.subtotal.toFixed(2), vat: s.taxTotal.toFixed(2), total: s.total.toFixed(2), status: s.status })) },
          { title: 'Top sellers', rows: topDrugs.map((t) => ({ product: t.name, units: t.qty, revenue: t.rev.toFixed(2) })) },
          { title: 'Expiry report', rows: expiryReport.map((d) => ({ product: d.name, batch: d.batchNumber, expiry: d.expiryDate, stock: d.stock })) },
        ])}>
          <FileSpreadsheet className="w-4 h-4" /> Export Excel
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <Stat label="Revenue (incl. VAT)" value={KES(revenue)} />
        <Stat label="Gross profit" value={KES(grossProfit)} />
        <Stat label="VAT collected" value={KES(tax)} />
        <Stat label="Inventory value (excl.)" value={KES(inventoryValue)} />
        <Stat label="Insurance receivables" value={KES(insuranceReceivable)} />
      </div>

      <div className="card p-5">
        <p className="font-semibold">Cash flow</p>
        <div className="mt-3 grid sm:grid-cols-3 gap-3 text-sm">
          <p className="flex justify-between sm:block"><span className="text-ink/50">Cash in (sales)</span><span className="font-mono font-bold block">{KES(revenue)}</span></p>
          <p className="flex justify-between sm:block"><span className="text-ink/50">Cash out (purchases received)</span><span className="font-mono font-bold block text-amber-600">-{KES(cashOut)}</span></p>
          <p className="flex justify-between sm:block"><span className="text-ink/50">Net cash flow</span><span className="font-mono font-bold block">{KES(revenue - cashOut)}</span></p>
        </div>
        {insuranceReceivable > 0 && (
          <p className="text-[11px] text-ink/40 mt-3">
            Includes {KES(insuranceReceivable)} in insurance-billed sales counted as revenue above but not yet paid out by the payer — see Insurance claims.
          </p>
        )}
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
