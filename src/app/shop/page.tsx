'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import { Cross, Search, ShoppingBag, Plus, Minus, CheckCircle2, X } from 'lucide-react';
import { db, seedIfEmpty, uid } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { cartTotals, KES } from '@/lib/utils';
import type { CartLine, Drug, OnlineOrder } from '@/lib/types';

const NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || 'Vitcare Healthcare Limited';

/**
 * Customer shop. Browsing reads the local catalog (demo) or Supabase
 * (connected). Placing an order writes to `orders` — Supabase Realtime pushes
 * it into every open POS dashboard instantly; in demo mode it lands directly
 * in the local orders queue.
 */
export default function Shop() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => { void seedIfEmpty(); }, []);

  const drugs = useLiveQuery(() => db.drugs.orderBy('name').toArray(), [], []);
  const cats = useMemo(() => ['All', ...Array.from(new Set((drugs ?? []).map((d) => d.category))).sort()], [drugs]);
  const visible = (drugs ?? []).filter((d) =>
    (cat === 'All' || d.category === cat) &&
    (!q.trim() || [d.name, d.genericName].some((f) => f.toLowerCase().includes(q.toLowerCase()))) &&
    d.stock > 0,
  );
  const totals = cartTotals(cart);

  function add(d: Drug) {
    setCart((c) => {
      const i = c.findIndex((l) => l.drugId === d.id);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { drugId: d.id, name: d.name, strength: d.strength, qty: 1, unitPrice: d.unitPrice, taxRate: d.taxRate }];
    });
  }
  const setQty = (id: string, qty: number) =>
    setCart((c) => (qty <= 0 ? c.filter((l) => l.drugId !== id) : c.map((l) => (l.drugId === id ? { ...l, qty } : l))));

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    const order: OnlineOrder = {
      id: uid(), customerName: name, customerPhone: phone,
      lines: cart, total: totals.total, status: 'new', createdAt: Date.now(), synced: 0,
    };
    await db.orders.add(order); // demo mode: appears in the POS queue immediately
    if (supabase) {
      await supabase.from('orders').insert({
        id: order.id, customer_name: name, customer_phone: phone,
        lines: cart, total: totals.total, status: 'new',
      });
    }
    setCart([]); setCheckout(false); setPlaced(true);
  }

  return (
    <main className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-30 bg-fir-deep text-white">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-leaf grid place-items-center"><Cross className="w-5 h-5 text-fir-deep" /></div>
          <div className="mr-auto">
            <p className="font-display font-bold leading-tight">{NAME}</p>
            <p className="text-[10px] text-mint/60 -mt-0.5">Order online · collect or get it delivered in Nairobi</p>
          </div>
          <Link href="/" className="text-xs text-mint/60 hover:text-mint hidden sm:block">Staff area</Link>
          <button className="relative btn bg-leaf text-fir-deep px-3 py-2" onClick={() => setCheckout(true)} aria-label="Open basket">
            <ShoppingBag className="w-5 h-5" />
            {cart.length > 0 && <span className="absolute -top-1.5 -right-1.5 chip bg-white text-fir text-[10px] px-1.5 py-0.5">{cart.reduce((a, l) => a + l.qty, 0)}</span>}
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
          <input className="input pl-9" placeholder="Search medicines and health products…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`chip border whitespace-nowrap ${cat === c ? 'bg-fir text-white border-fir' : 'bg-white text-fir border-mint-deep'}`}>{c}</button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {visible.map((d) => (
            <motion.div key={d.id} layout className="card p-4 flex flex-col">
              <p className="font-semibold text-sm leading-tight">{d.name}</p>
              <p className="text-[11px] text-ink/50">{d.genericName} · {d.strength} {d.dosageForm}</p>
              <div className="mt-auto pt-3 flex items-center justify-between">
                <span className="font-mono font-bold">{KES(d.unitPrice * (1 + d.taxRate))}</span>
                <button className="btn-leaf px-3 py-1.5 text-sm" onClick={() => add(d)}><Plus className="w-4 h-4" /> Add</button>
              </div>
            </motion.div>
          ))}
          {visible.length === 0 && <p className="col-span-full text-center text-ink/40 py-10">No products found.</p>}
        </div>

        <p className="text-[11px] text-ink/40 text-center pt-4">
          Prescription-only medicines are dispensed after our pharmacist confirms a valid prescription at pickup or delivery.
        </p>
      </div>

      {/* Basket drawer */}
      <AnimatePresence>
        {checkout && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={() => setCheckout(false)}>
            <motion.div initial={{ x: 380 }} animate={{ x: 0 }} exit={{ x: 380 }} transition={{ type: 'tween' }}
              className="w-full max-w-sm bg-white h-full p-5 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-lg">Your basket</h2>
                <button onClick={() => setCheckout(false)} className="p-1 rounded-lg hover:bg-mint"><X className="w-5 h-5" /></button>
              </div>
              <div className="mt-4 space-y-3">
                {cart.map((l) => (
                  <div key={l.drugId} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{l.name}</span>
                    <button className="w-7 h-7 rounded-lg bg-mint grid place-items-center" onClick={() => setQty(l.drugId, l.qty - 1)}><Minus className="w-3.5 h-3.5" /></button>
                    <span className="w-6 text-center font-mono">{l.qty}</span>
                    <button className="w-7 h-7 rounded-lg bg-mint grid place-items-center" onClick={() => setQty(l.drugId, l.qty + 1)}><Plus className="w-3.5 h-3.5" /></button>
                    <span className="w-20 text-right font-mono">{(l.unitPrice * (1 + l.taxRate) * l.qty).toFixed(0)}</span>
                  </div>
                ))}
                {!cart.length && <p className="text-sm text-ink/40 py-8 text-center">Your basket is empty.</p>}
              </div>
              {cart.length > 0 && (
                <form onSubmit={placeOrder} className="mt-5 space-y-3 border-t border-dashed border-mint-deep pt-4">
                  <p className="flex justify-between font-bold"><span>Total (incl. VAT)</span><span className="font-mono">{KES(totals.total)}</span></p>
                  <input className="input" placeholder="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
                  <input className="input" placeholder="Phone (07XX…)" required inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  <button className="btn-primary w-full">Place order</button>
                  <p className="text-[11px] text-ink/40">We&apos;ll call to confirm availability and arrange payment (M-Pesa) and pickup/delivery.</p>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {placed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={() => setPlaced(false)}>
            <motion.div initial={{ scale: 0.94 }} animate={{ scale: 1 }} className="bg-white rounded-2xl p-8 text-center max-w-sm">
              <CheckCircle2 className="w-12 h-12 mx-auto text-leaf" />
              <h3 className="mt-3 font-bold text-lg">Order received</h3>
              <p className="mt-1 text-sm text-ink/60">Our pharmacist has your order and will call you shortly to confirm.</p>
              <button className="btn-primary mt-5 w-full" onClick={() => setPlaced(false)}>Keep browsing</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
