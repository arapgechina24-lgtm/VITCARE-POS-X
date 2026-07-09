/**
 * Safaricom Daraja (M-Pesa) server-side helpers — Lipa na M-Pesa Online (STK Push).
 *
 * Security posture: all credentials come from environment variables and never
 * reach the client. Without credentials the module runs in SIMULATION mode so
 * the checkout flow is fully demonstrable.
 *
 * Payment-status persistence: uses a Supabase `payments` table when
 * SUPABASE_SERVICE_ROLE_KEY is configured (required on serverless hosts where
 * process memory is not shared between invocations); otherwise an in-memory
 * map suffices for local dev.
 */
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

export const mpesaConfigured = Boolean(
  process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET && process.env.MPESA_PASSKEY,
);

type PayStatus = { status: 'pending' | 'paid' | 'failed'; ref?: string; reason?: string };

const g = globalThis as unknown as { __vitcarePayments?: Map<string, PayStatus> };
const mem = (g.__vitcarePayments ??= new Map<string, PayStatus>());

const admin = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

export async function setPayment(id: string, s: PayStatus) {
  mem.set(id, s);
  if (admin) {
    await admin.from('payments').upsert({ id, status: s.status, ref: s.ref ?? null, reason: s.reason ?? null });
  }
}

export async function getPayment(id: string): Promise<PayStatus | null> {
  if (admin) {
    const { data } = await admin.from('payments').select('*').eq('id', id).maybeSingle();
    if (data) return { status: data.status, ref: data.ref ?? undefined, reason: data.reason ?? undefined };
  }
  return mem.get(id) ?? null;
}

async function oauthToken(): Promise<string> {
  const auth = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`,
  ).toString('base64');
  const res = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`);
  const j = (await res.json()) as { access_token: string };
  return j.access_token;
}

/** Normalise Kenyan MSISDN to 2547XXXXXXXX / 2541XXXXXXXX */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  if (/^0(7|1)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

export async function stkPush(phone: string, amount: number, accountRef: string) {
  const token = await oauthToken();
  const shortcode = process.env.MPESA_SHORTCODE || '174379';
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${ts}`).toString('base64');

  const res = await fetch(`${BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.max(1, Math.round(amount)),
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL || 'https://example.invalid/api/mpesa/callback',
      AccountReference: accountRef.slice(0, 12),
      TransactionDesc: 'Vitcare POS sale',
    }),
  });
  const j = (await res.json()) as Record<string, string>;
  if (!res.ok || j.ResponseCode !== '0') {
    throw new Error(j.errorMessage || j.ResponseDescription || 'STK push rejected');
  }
  return j.CheckoutRequestID;
}
