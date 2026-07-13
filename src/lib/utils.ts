import type { CartLine, Discount, EtimsStamp, EtimsTaxBreakdown } from './types';

export const KES = (n: number) =>
  `KSh ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Per-line tax breakdown. Prices are stored VAT-exclusive. */
export function lineTotals(l: CartLine) {
  const excl = l.unitPrice * l.qty;
  const tax = excl * l.taxRate;
  return { excl, tax, incl: excl + tax };
}

/** Cart totals, with an optional whole-sale discount scaled proportionally across
 *  the excl./tax split (so VAT is still charged on the post-discount price). */
export function cartTotals(lines: CartLine[], discount?: Discount | null) {
  let subtotal = 0, taxTotal = 0;
  for (const l of lines) {
    const t = lineTotals(l);
    subtotal += t.excl;
    taxTotal += t.tax;
  }
  const gross = subtotal + taxTotal;
  let discountAmount = 0;
  if (discount && discount.value > 0 && gross > 0) {
    discountAmount = discount.type === 'percent'
      ? gross * Math.min(discount.value, 100) / 100
      : Math.min(discount.value, gross);
  }
  const scale = gross > 0 ? (gross - discountAmount) / gross : 1;
  return { subtotal: subtotal * scale, taxTotal: taxTotal * scale, total: gross - discountAmount, discountAmount };
}

/** KRA VAT tax category: A = Exempt (0% — most human medicines), B = Standard (16%). */
export const taxCategory = (taxRate: number): 'A' | 'B' => (taxRate > 0 ? 'B' : 'A');

/** Groups cart lines into KRA-style tax categories for invoice/receipt display. */
export function buildEtimsTaxBreakdown(lines: CartLine[]): EtimsTaxBreakdown[] {
  const byCode = new Map<'A' | 'B', EtimsTaxBreakdown>();
  for (const l of lines) {
    const code = taxCategory(l.taxRate);
    const { excl, tax } = lineTotals(l);
    const cur = byCode.get(code) ?? { code, label: code === 'B' ? 'VAT 16% (B)' : 'Exempt (A)', taxableAmount: 0, taxAmount: 0 };
    cur.taxableAmount += excl;
    cur.taxAmount += tax;
    byCode.set(code, cur);
  }
  return Array.from(byCode.values());
}

/** Simulated eTIMS stamp — used offline and whenever no KRA device/API is configured.
 *  In production these fields are returned by the KRA OSCU/VSCU control unit after
 *  real-time invoice transmission — see src/lib/etims.ts and /api/etims/invoice. */
export function demoEtimsStamp(invoiceNo: string, lines: CartLine[] = []): EtimsStamp {
  const sig = Array.from(invoiceNo)
    .reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16).toUpperCase().padStart(8, '0');
  return {
    scuId: 'KRACU0300001234',
    receiptSignature: `${sig}-${sig.split('').reverse().join('')}`,
    internalData: `DEMO-${invoiceNo}`,
    verifyUrl: `https://itax.kra.go.ke/KRA-Portal/invoiceChk?inv=${encodeURIComponent(invoiceNo)}`,
    taxBreakdown: buildEtimsTaxBreakdown(lines),
  };
}

export function downloadCSV(filename: string, rows: Array<Record<string, string | number>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const daysUntil = (iso: string) =>
  Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

const escapeHtml = (v: string | number) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Excel export without a charting/spreadsheet dependency: Excel opens an HTML
 *  table saved with an .xls extension as a workbook. Good enough for reporting
 *  exports; for pixel-perfect multi-sheet workbooks, reach for a real xlsx lib. */
export function downloadXLS(filename: string, sections: Array<{ title: string; rows: Array<Record<string, string | number>> }>) {
  const nonEmpty = sections.filter((s) => s.rows.length);
  if (!nonEmpty.length) return;
  const body = nonEmpty.map((s) => {
    const headers = Object.keys(s.rows[0]);
    return `
      <h3>${escapeHtml(s.title)}</h3>
      <table border="1">
        <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${s.rows.map((r) => `<tr>${headers.map((h) => `<td>${escapeHtml(r[h])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
  }).join('<br/>');
  const html = `<html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Opens a self-contained, A4-print-styled window and triggers Print (→ Save as PDF).
 *  Runs in its own window so it never conflicts with the app's thermal receipt print CSS. */
export function printReport(title: string, bodyHtml: string) {
  const w = window.open('', '_blank', 'width=800,height=1000');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><meta charset="utf-8">
    <style>
      @page { size: A4; margin: 16mm; }
      body { font-family: system-ui, sans-serif; color: #0f172a; font-size: 12px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 13px; margin: 18px 0 6px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
      th, td { border: 1px solid #cbd5e1; padding: 4px 8px; text-align: left; font-size: 11px; }
      th { background: #f0f9ff; }
      .right { text-align: right; }
    </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <p style="color:#64748b">${new Date().toLocaleString('en-KE')}</p>
    ${bodyHtml}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 200);
}
