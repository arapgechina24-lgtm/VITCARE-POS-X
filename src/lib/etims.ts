/**
 * KRA eTIMS (electronic Tax Invoice Management System) invoice generation.
 *
 * Real eTIMS compliance runs through a KRA-certified OSCU/VSCU control unit —
 * a vendor-supplied local device or middleware, not a plain public REST API
 * you can call with just an API key (see KRA's eTIMS onboarding guide for the
 * certified device vendor list). This module stays deliberately thin and
 * swappable: once you have a device endpoint and credentials, point
 * KRA_ETIMS_BASE_URL / KRA_ETIMS_CU_SERIAL / KRA_ETIMS_API_KEY at it and
 * adapt `callDevice` below to that vendor's exact request/response shape.
 * Until then, every invoice runs in Simulation Mode via `demoEtimsStamp` so
 * checkout and receipts work end-to-end offline and in demos.
 */
import { demoEtimsStamp, taxCategory } from './utils';
import type { CartLine, EtimsStamp } from './types';

export const etimsConfigured = Boolean(process.env.KRA_ETIMS_BASE_URL && process.env.KRA_ETIMS_CU_SERIAL);

async function callDevice(invoiceNo: string, lines: CartLine[], customerPin?: string): Promise<EtimsStamp> {
  const base = process.env.KRA_ETIMS_BASE_URL!;
  const res = await fetch(`${base.replace(/\/$/, '')}/invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.KRA_ETIMS_API_KEY ?? ''}`,
      'X-CU-Serial': process.env.KRA_ETIMS_CU_SERIAL ?? '',
    },
    body: JSON.stringify({
      invoiceNumber: invoiceNo,
      customerPin: customerPin || undefined,
      items: lines.map((l) => ({
        name: l.name, quantity: l.qty, unitPrice: l.unitPrice,
        taxCategory: taxCategory(l.taxRate), taxRate: l.taxRate,
      })),
    }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`eTIMS device rejected invoice: ${res.status}`);
  const j = (await res.json()) as { scuId: string; receiptSignature: string; internalData: string; verifyUrl: string };
  return { ...demoEtimsStamp(invoiceNo, lines), ...j };
}

/** Generates the KRA invoice stamp for a sale — real device call when configured,
 *  simulation otherwise (and as a safety-net fallback if the device call fails). */
export async function generateInvoice(invoiceNo: string, lines: CartLine[], customerPin?: string): Promise<EtimsStamp> {
  if (!etimsConfigured) return demoEtimsStamp(invoiceNo, lines);
  try {
    return await callDevice(invoiceNo, lines, customerPin);
  } catch (e) {
    console.error('[etims] device call failed, falling back to simulation', e);
    return demoEtimsStamp(invoiceNo, lines);
  }
}
