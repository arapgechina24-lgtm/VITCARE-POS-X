'use client';
import QRCode from 'react-qr-code';
import type { Sale } from '@/lib/types';
import { KES, lineTotals, taxCategory } from '@/lib/utils';

const NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || 'Vitcare Pharmacy and Medical Centre';
const PIN = process.env.NEXT_PUBLIC_KRA_PIN || 'P051234567X';

/**
 * KRA eTIMS-format tax invoice, styled for both an 80 mm thermal roll
 * (see @media print in globals.css) and A4 browser printing.
 * Per line: unit price excl. VAT, VAT amount, line total incl. VAT.
 */
export default function Receipt({ sale }: { sale: Sale }) {
  const dt = new Date(sale.createdAt);
  return (
    <div id="print-receipt" className="bg-white text-black font-mono text-[11px] leading-relaxed p-4 rounded-xl border border-mint-deep max-w-xs mx-auto">
      <div className="text-center">
        <p className="font-bold text-sm">{NAME}</p>
        <p>Next to Modern Market, Naivasha · Tel 0700 000 000</p>
        <p>KRA PIN: {PIN}</p>
        <p className="mt-1 font-bold">TAX INVOICE</p>
      </div>

      <div className="mt-2 border-t border-dashed border-black/40 pt-2">
        <p>Invoice: {sale.invoiceNo}</p>
        <p>Date: {dt.toLocaleDateString('en-KE')} {dt.toLocaleTimeString('en-KE')}</p>
        {sale.customerName && <p>Customer: {sale.customerName}</p>}
        {sale.customerPin && <p>Buyer PIN: {sale.customerPin}</p>}
        <p>Payment: {sale.method.toUpperCase()}{sale.mpesaRef ? ` · ${sale.mpesaRef}` : ''}</p>
      </div>

      <table className="w-full mt-2 border-t border-dashed border-black/40">
        <thead>
          <tr className="text-left">
            <th className="py-1 font-bold">Item</th>
            <th className="text-right font-bold">Excl</th>
            <th className="text-right font-bold">VAT</th>
            <th className="text-right font-bold">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((l) => {
            const t = lineTotals(l);
            return (
              <tr key={l.drugId} className="align-top">
                <td className="py-0.5 pr-1">
                  {l.name} {l.strength}
                  <br />
                  <span className="text-[10px]">{l.qty} × {l.unitPrice.toFixed(2)} @ {(l.taxRate * 100).toFixed(0)}% (Cat {taxCategory(l.taxRate)})</span>
                </td>
                <td className="text-right">{t.excl.toFixed(2)}</td>
                <td className="text-right">{t.tax.toFixed(2)}</td>
                <td className="text-right">{t.incl.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-2 border-t border-dashed border-black/40 pt-2 space-y-0.5">
        <p className="flex justify-between"><span>Subtotal (excl. VAT)</span><span>{KES(sale.subtotal)}</span></p>
        <p className="flex justify-between"><span>VAT (16%)</span><span>{KES(sale.taxTotal)}</span></p>
        <p className="flex justify-between font-bold text-sm"><span>TOTAL</span><span>{KES(sale.total)}</span></p>
      </div>

      {sale.etims && (
        <div className="mt-2 border-t border-dashed border-black/40 pt-2">
          {sale.etims.taxBreakdown && sale.etims.taxBreakdown.length > 0 && (
            <div className="mb-1.5">
              {sale.etims.taxBreakdown.map((b) => (
                <p key={b.code} className="flex justify-between text-[10px]">
                  <span>{b.label}: taxable {b.taxableAmount.toFixed(2)}</span><span>tax {b.taxAmount.toFixed(2)}</span>
                </p>
              ))}
            </div>
          )}
          <p>SCU ID: {sale.etims.scuId}</p>
          <p className="break-all">Receipt Sign: {sale.etims.receiptSignature}</p>
          <div className="mt-2 flex justify-center bg-white p-1">
            <QRCode value={sale.etims.verifyUrl} size={84} />
          </div>
          <p className="text-center text-[10px] mt-1">Scan to verify on iTax</p>
        </div>
      )}

      <p className="mt-3 text-center">Asante — get well soon!</p>
      <p className="text-center text-[10px]">Refunds &amp; exchanges are at pharmacist/admin discretion — bring this receipt.</p>
    </div>
  );
}
