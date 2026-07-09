'use client';
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, Send, X, Loader2 } from 'lucide-react';
import { db } from '@/lib/db';
import { daysUntil, KES } from '@/lib/utils';

interface Msg { role: 'user' | 'bot'; text: string }

const QUICK = ["What's low in stock?", 'Anything expiring soon?', "Summarise today's sales", 'Alternatives to Panadol'];

/**
 * Vita — the in-store assistant. Sends the question plus a compact live
 * snapshot (inventory + today's aggregates, no customer PII) to /api/assistant.
 * If no LLM key is configured server-side, answers locally with a rule-based
 * engine over IndexedDB, so the feature always works — even fully offline.
 */
export default function Assistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'bot', text: 'Habari! I\'m Vita 🌿 Ask me about stock, expiries, alternatives or today\'s sales.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  async function buildContext() {
    const drugs = await db.drugs.toArray();
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const sales = await db.sales.where('createdAt').aboveOrEqual(t0.getTime()).toArray();
    return {
      inventory: drugs.map((d) => ({
        name: d.name, generic: d.genericName, strength: d.strength, category: d.category,
        stock: d.stock, reorderLevel: d.reorderLevel, priceExcl: d.unitPrice, taxRate: d.taxRate,
        expiry: d.expiryDate,
      })),
      today: {
        transactions: sales.length,
        revenueInclVat: sales.reduce((a, s) => a + s.total, 0),
        vatCollected: sales.reduce((a, s) => a + s.taxTotal, 0),
      },
    };
  }

  /** Deterministic fallback so the assistant works offline / without an API key. */
  async function ruleBased(q: string): Promise<string> {
    const drugs = await db.drugs.toArray();
    const lq = q.toLowerCase();

    if (/low|stock.*out|out of stock|reorder/.test(lq)) {
      const low = drugs.filter((d) => d.stock <= d.reorderLevel);
      if (!low.length) return 'Nothing is below its reorder level right now. 👍';
      return `Below reorder level:\n${low.map((d) => `• ${d.name} — ${d.stock} left (reorder at ${d.reorderLevel})`).join('\n')}`;
    }
    if (/expir|near.?expiry/.test(lq)) {
      const exp = drugs.filter((d) => daysUntil(d.expiryDate) <= 90).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
      if (!exp.length) return 'No batches expire within the next 90 days.';
      return `Expiring within 90 days:\n${exp.map((d) => `• ${d.name} (${d.batchNumber}) — ${d.expiryDate}`).join('\n')}`;
    }
    if (/sales|revenue|today|summar/.test(lq)) {
      const t0 = new Date(); t0.setHours(0, 0, 0, 0);
      const sales = await db.sales.where('createdAt').aboveOrEqual(t0.getTime()).toArray();
      const rev = sales.reduce((a, s) => a + s.total, 0);
      const vat = sales.reduce((a, s) => a + s.taxTotal, 0);
      return `Today so far: ${sales.length} transactions, ${KES(rev)} revenue, ${KES(vat)} VAT collected.`;
    }
    if (/alternativ|substitute|instead of/.test(lq)) {
      const target = drugs.find((d) => lq.includes(d.name.toLowerCase()) || lq.includes(d.genericName.toLowerCase()));
      if (target) {
        const alts = drugs.filter((d) => d.id !== target.id &&
          (d.genericName === target.genericName || d.category === target.category) && d.stock > 0);
        if (alts.length) return `In-catalog options near ${target.name} (${target.genericName}):\n${alts.map((d) => `• ${d.name} ${d.strength} — ${d.stock} in stock, ${KES(d.unitPrice * (1 + d.taxRate))}`).join('\n')}\nFinal substitution is the pharmacist's call.`;
        return `No in-stock alternatives found for ${target.name} in the catalog.`;
      }
    }
    // generic catalog search
    const hits = drugs.filter((d) => [d.name, d.genericName, d.category].some((f) => lq.includes(f.toLowerCase()) || f.toLowerCase().includes(lq))).slice(0, 6);
    if (hits.length) {
      return hits.map((d) => `• ${d.name} ${d.strength} (${d.genericName}) — ${d.stock} in stock, ${KES(d.unitPrice * (1 + d.taxRate))}, exp ${d.expiryDate}`).join('\n');
    }
    return 'I couldn\'t match that in the catalog. Try a drug name, "low stock", "expiring", or "today\'s sales". (Connect an Anthropic API key for full natural-language answers — see README.)';
  }

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    setBusy(true);
    try {
      let answer: string | null = null;
      try {
        const res = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, context: await buildContext() }),
        });
        const j = await res.json();
        if (res.ok && j.answer) answer = j.answer;
      } catch { /* offline — fall back */ }
      answer ??= await ruleBased(q);
      setMsgs((m) => [...m, { role: 'bot', text: answer! }]);
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollTo({ top: 1e6, behavior: 'smooth' }), 60);
    }
  }

  return (
    <>
      <motion.button whileTap={{ scale: 0.92 }} onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-2xl bg-fir text-leaf-soft shadow-lift grid place-items-center print:hidden"
        aria-label="Open Vita assistant">
        <Sparkles className="w-6 h-6" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-5 right-5 z-50 w-[min(96vw,380px)] h-[540px] max-h-[80dvh] card flex flex-col overflow-hidden print:hidden">
            <div className="flex items-center gap-2 px-4 h-12 bg-fir text-white shrink-0">
              <Sparkles className="w-4 h-4 text-leaf-soft" />
              <p className="font-semibold text-sm">Vita — store assistant</p>
              <button className="ml-auto p-1" onClick={() => setOpen(false)} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>

            <div ref={scroller} className="flex-1 overflow-y-auto p-3 space-y-2">
              {msgs.map((m, i) => (
                <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'ml-auto bg-fir text-white' : 'bg-mint text-ink'}`}>
                  {m.text}
                </div>
              ))}
              {busy && <Loader2 className="w-4 h-4 animate-spin text-leaf ml-2" />}
            </div>

            <div className="px-3 pb-1 flex flex-wrap gap-1.5">
              {QUICK.map((s) => (
                <button key={s} className="chip bg-mint text-fir border border-mint-deep" onClick={() => void ask(s)}>{s}</button>
              ))}
            </div>
            <form className="p-3 pt-2 flex gap-2 shrink-0" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
              <input className="input text-sm" placeholder="Ask about stock, expiry, sales…" value={input} onChange={(e) => setInput(e.target.value)} />
              <button className="btn-leaf px-3" disabled={busy || !input.trim()} aria-label="Send"><Send className="w-4 h-4" /></button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
