import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * AI assistant endpoint. The client sends the user's question plus a compact,
 * non-sensitive snapshot of live inventory/sales context (names, stock,
 * expiries, aggregates — no customer PII). If ANTHROPIC_API_KEY is set we call
 * the Anthropic Messages API; otherwise we return { fallback: true } and the
 * client answers with its built-in rule-based engine over IndexedDB.
 */
const SYSTEM = `You are Vita, the in-store assistant for Vitcare Pharmacy and Medical Centre, a licensed pharmacy in Naivasha, Kenya.
You help pharmacy STAFF with: finding drugs in the catalog, stock and expiry checks, suggesting in-catalog alternatives (same generic/class), summarising sales, and general pharmacy reference knowledge.
Rules: base stock/price/expiry answers ONLY on the provided context JSON. Never invent inventory. For clinical questions, give general reference information and remind staff that dispensing decisions rest with the pharmacist. Keep answers short and practical. Currency is KES.`;

interface Body { question?: string; context?: unknown }

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const question = String(body.question ?? '').slice(0, 1000).trim();
  if (!question) return NextResponse.json({ error: 'Empty question' }, { status: 400 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ fallback: true });

  const context = JSON.stringify(body.context ?? {}).slice(0, 60_000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 700,
        system: SYSTEM,
        messages: [
          { role: 'user', content: `LIVE STORE CONTEXT (JSON):\n${context}\n\nSTAFF QUESTION: ${question}` },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[assistant] upstream', res.status, t.slice(0, 300));
      return NextResponse.json({ fallback: true });
    }
    const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    const answer = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json({ fallback: true });
  }
}
