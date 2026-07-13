import { NextRequest, NextResponse } from 'next/server';
import { generateInvoice } from '@/lib/etims';
import type { CartLine } from '@/lib/types';

export const runtime = 'nodejs';

interface Body { invoiceNo?: string; lines?: CartLine[]; customerPin?: string }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const invoiceNo = String(body.invoiceNo ?? '').trim();
  if (!invoiceNo || !Array.isArray(body.lines) || !body.lines.length) {
    return NextResponse.json({ error: 'invoiceNo and lines are required' }, { status: 400 });
  }

  const stamp = await generateInvoice(invoiceNo, body.lines, body.customerPin);
  return NextResponse.json(stamp);
}
