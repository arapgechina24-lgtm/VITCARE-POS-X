import type { CartLine, EtimsStamp } from './types';

export const KES = (n: number) =>
  `KSh ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Per-line tax breakdown. Prices are stored VAT-exclusive. */
export function lineTotals(l: CartLine) {
  const excl = l.unitPrice * l.qty;
  const tax = excl * l.taxRate;
  return { excl, tax, incl: excl + tax };
}

export function cartTotals(lines: CartLine[]) {
  let subtotal = 0, taxTotal = 0;
  for (const l of lines) {
    const t = lineTotals(l);
    subtotal += t.excl;
    taxTotal += t.tax;
  }
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}

/** Demo eTIMS stamp. In production these fields are returned by the KRA
 *  OSCU/VSCU after real-time invoice transmission — see /api/etims notes. */
export function demoEtimsStamp(invoiceNo: string): EtimsStamp {
  const sig = Array.from(invoiceNo)
    .reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
    .toString(16).toUpperCase().padStart(8, '0');
  return {
    scuId: 'KRACU0300001234',
    receiptSignature: `${sig}-${sig.split('').reverse().join('')}`,
    internalData: `DEMO-${invoiceNo}`,
    verifyUrl: `https://itax.kra.go.ke/KRA-Portal/invoiceChk?inv=${encodeURIComponent(invoiceNo)}`,
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
