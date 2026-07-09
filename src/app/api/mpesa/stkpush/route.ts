import { NextRequest, NextResponse } from 'next/server';
import { mpesaConfigured, normalizePhone, setPayment, stkPush } from '@/lib/mpesa';

export const runtime = 'nodejs';

/* Naive per-instance rate limit (defence-in-depth; pair with platform WAF). */
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip) ?? { n: 0, t: now };
  if (now - h.t > 60_000) { h.n = 0; h.t = now; }
  h.n += 1;
  hits.set(ip, h);
  return h.n > 10;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (limited(ip)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: { phone?: string; amount?: number; ref?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const phone = normalizePhone(String(body.phone ?? ''));
  const amount = Number(body.amount);
  const ref = String(body.ref ?? 'VITCARE').replace(/[^\w-]/g, '').slice(0, 12);
  if (!phone) return NextResponse.json({ error: 'Enter a valid Safaricom number (07XX… or 2547XX…)' }, { status: 400 });
  if (!Number.isFinite(amount) || amount < 1 || amount > 500_000) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }

  // Simulation mode — no Daraja credentials configured.
  if (!mpesaConfigured) {
    const id = `SIM-${Date.now()}`;
    await setPayment(id, { status: 'pending' });
    setTimeout(() => { void setPayment(id, { status: 'paid', ref: `S${Date.now().toString().slice(-8)}KE` }); }, 5000);
    return NextResponse.json({ checkoutRequestId: id, simulated: true });
  }

  try {
    const id = await stkPush(phone, amount, ref);
    await setPayment(id, { status: 'pending' });
    return NextResponse.json({ checkoutRequestId: id, simulated: false });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'STK push failed' }, { status: 502 });
  }
}
