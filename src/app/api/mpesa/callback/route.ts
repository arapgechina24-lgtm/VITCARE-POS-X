import { NextRequest, NextResponse } from 'next/server';
import { setPayment } from '@/lib/mpesa';

export const runtime = 'nodejs';

/**
 * Daraja result webhook. Safaricom POSTs the STK result here.
 * Register this URL (must be public HTTPS) as MPESA_CALLBACK_URL.
 * Hardening for production: allowlist Safaricom egress IPs at the edge and
 * treat this endpoint as untrusted input — we only ever mark our own
 * pre-created CheckoutRequestID records, never create records from it.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const cb = body?.Body?.stkCallback;
    const id: string | undefined = cb?.CheckoutRequestID;
    if (!id) return NextResponse.json({ ResultCode: 0 });
    if (cb.ResultCode === 0) {
      const items: Array<{ Name: string; Value?: string | number }> = cb.CallbackMetadata?.Item ?? [];
      const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value;
      await setPayment(id, { status: 'paid', ref: String(receipt ?? '') });
    } else {
      await setPayment(id, { status: 'failed', reason: String(cb.ResultDesc ?? 'Declined') });
    }
  } catch {
    /* swallow — Daraja retries on non-200 */
  }
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
