import { NextRequest, NextResponse } from 'next/server';
import { getPayment } from '@/lib/mpesa';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^[\w-]{4,64}$/.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  const p = await getPayment(id);
  return NextResponse.json(p ?? { status: 'pending' });
}
