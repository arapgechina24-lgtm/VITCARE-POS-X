'use client';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search, Plus, Minus, Trash2, PauseCircle, PlayCircle, Banknote,
  Smartphone, Printer, CheckCircle2, Loader2, XCircle, ScanBarcode, Tag, X, ShieldPlus,
} from 'lucide-react';
import { db, logAudit, nextInvoiceNo, uid } from '@/lib/db';
import { usePos } from '@/lib/store';
import { cartTotals, demoEtimsStamp, KES, lineTotals } from '@/lib/utils';
import { sounds } from '@/lib/sounds';
import type { Discount, InsuranceClaim, PaymentMethod, Sale } from '@/lib/types';
import Receipt from '@/components/Receipt';

type PayState =
  | { step: 'idle' }
  | { step: 'cash' }
  | { step: 'mpesa-phone' }
  | { step: 'mpesa-wait'; id: string }
  | { step: 'insurance' }
  | { step: 'done'; sale: Sale }
  | { step: 'failed'; reason: string };

export default function PosPage() {
  const { lines, addDrug, setQty, remove, clear, hold, recall, held, discount, setDiscount } = usePos();
  const [q, setQ] = useState('');
  const [pay, setPay] = useState<PayState>({ step: 'idle' });
  const [cashGiven, setCashGiven] = useState('');
  const [phone, setPhone] = useState('');
  const [custName, setCustName] = useState('');
  const [custPin, setCustPin] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountType, setDiscountType] = useState<Discount['type']>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [providerId, setProviderId] = useState('');
  const [memberNo, setMemberNo] = useState('');
  const [coPay, setCoPay] = useState('');
  const [matchedCustomerId, setMatchedCustomerId] = useState('');

  const drugs = useLiveQuery(async () => {
    const all = await db.drugs.toArray();
    const term = q.trim().toLowerCase();
    if (!term) return all.slice(0, 24);
    return all.filter((d) =>
      [d.name, d.genericName, d.category, d.barcode].some((f) => f.toLowerCase().includes(term)),
    ).slice(0, 24);
  }, [q], []);
  const providers = useLiveQuery(() => db.insuranceProviders.orderBy('name').toArray(), [], []);
  const selectedProvider = (providers ?? []).find((p) => p.id === providerId);

  const totals = useMemo(() => cartTotals(lines, discount), [lines, discount]);
  const change = Number(cashGiven || 0) - totals.total;

  async function completeSale(method: PaymentMethod, mpesaRef?: string) {
    const invoiceNo = await nextInvoiceNo();
    let etims = demoEtimsStamp(invoiceNo, lines); // offline-safe default
    try {
      const res = await fetch('/api/etims/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceNo, lines, customerPin: custPin || undefined }),
      });
      if (res.ok) etims = await res.json();
    } catch { /* offline — keep the local simulated stamp */ }

    const sale: Sale = {
      id: uid(),
      invoiceNo,
      lines,
      ...totals,
      discount: discount ?? undefined,
      method,
      status: 'paid',
      customerId: matchedCustomerId || undefined,
      customerName: custName || undefined,
      customerPin: custPin || undefined,
      customerPhone: phone || undefined,
      mpesaRef,
      createdAt: Date.now(),
      synced: 0,
      etims,
    };

    let claim: InsuranceClaim | undefined;
    if (method === 'insurance' && selectedProvider) {
      const coPayAmount = Math.min(Math.max(0, Number(coPay) || 0), totals.total);
      claim = {
        id: uid(),
        saleId: sale.id,
        invoiceNo,
        providerId: selectedProvider.id,
        providerName: selectedProvider.name,
        memberNo,
        patientName: custName || 'Walk-in',
        claimAmount: totals.total - coPayAmount,
        coPayAmount,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      sale.insuranceClaimId = claim.id;
    }

    await db.transaction('rw', db.sales, db.drugs, db.syncQueue, db.insuranceClaims, async () => {
      await db.sales.add(sale);
      for (const l of lines) {
        const d = await db.drugs.get(l.drugId);
        if (d) await db.drugs.update(l.drugId, { stock: Math.max(0, d.stock - l.qty), updatedAt: Date.now() });
      }
      await db.syncQueue.add({ table: 'sales', op: 'upsert', payload: sale, createdAt: Date.now() });
      if (claim) {
        await db.insuranceClaims.add(claim);
        await db.syncQueue.add({ table: 'insuranceClaims', op: 'upsert', payload: claim, createdAt: Date.now() });
      }
    });
    await logAudit('cashier', 'sale', `${invoiceNo} · ${KES(sale.total)} · ${method}`);
    if (claim) await logAudit('cashier', 'claim.create', `${invoiceNo} · ${claim.providerName} · ${KES(claim.claimAmount)}`);
    clear();
    setCashGiven(''); setPhone(''); setCustName(''); setCustPin(''); setDiscountOpen(false); setDiscountValue('');
    setProviderId(''); setMemberNo(''); setCoPay(''); setMatchedCustomerId('');
    sounds.success();
    setPay({ step: 'done', sale });
  }

  /** Looks up a saved customer by phone (or name) to auto-fill their insurance
   *  details — avoids re-keying a member number on every repeat visit. */
  async function openInsurance() {
    const match = phone
      ? await db.customers.where('phone').equals(phone).first()
      : custName
        ? (await db.customers.where('name').equalsIgnoreCase(custName).first())
        : undefined;
    if (match) {
      setMatchedCustomerId(match.id);
      if (match.insuranceProviderId) {
        setProviderId(match.insuranceProviderId);
        setMemberNo(match.insuranceMemberNo ?? '');
        const p = (providers ?? []).find((x) => x.id === match.insuranceProviderId);
        setCoPay(p ? String(Math.round(totals.total * p.defaultCoPayPercent) / 100) : '');
      }
    }
    setPay({ step: 'insurance' });
    sounds.tap();
  }

  async function promptMpesa() {
    try {
      setPay({ step: 'mpesa-wait', id: '…' });
      const res = await fetch('/api/mpesa/stkpush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, amount: totals.total, ref: 'VITCARE' }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Prompt failed');
      setPay({ step: 'mpesa-wait', id: j.checkoutRequestId });
      pollStatus(j.checkoutRequestId);
    } catch (e) {
      sounds.error();
      setPay({ step: 'failed', reason: e instanceof Error ? e.message : 'Prompt failed' });
    }
  }

  function pollStatus(id: string) {
    let tries = 0;
    const t = setInterval(async () => {
      tries += 1;
      try {
        const r = await fetch(`/api/mpesa/status?id=${encodeURIComponent(id)}`);
        const j = await r.json();
        if (j.status === 'paid') {
          clearInterval(t);
          sounds.payment();
          await completeSale('mpesa', j.ref);
        } else if (j.status === 'failed' || tries > 40) {
          clearInterval(t);
          sounds.error();
          setPay({ step: 'failed', reason: j.reason || 'Customer did not complete payment.' });
        }
      } catch { /* transient — keep polling */ }
    }, 3000);
  }

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-5 animate-rise">
      {/* ── Catalog search ── */}
      <section>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
            <input className="input pl-9" placeholder="Search name, generic, category or scan barcode…"
              value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <button className="btn-ghost border border-mint-deep" title="Barcode scan — type or wedge-scan into search"
            onClick={() => sounds.tap()}>
            <ScanBarcode className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {(drugs ?? []).map((d) => (
            <motion.button key={d.id} layout whileTap={{ scale: 0.97 }}
              onClick={() => { addDrug(d); sounds.add(); }}
              className="card p-3 text-left hover:shadow-lift transition group">
              <p className="font-semibold text-sm leading-tight group-hover:text-fir">{d.name}</p>
              <p className="text-[11px] text-ink/50 dark:text-mint/50">{d.genericName} · {d.strength}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-sm font-bold">{KES(d.unitPrice * (1 + d.taxRate))}</span>
                <span className={`chip ${d.stock <= d.reorderLevel ? 'bg-amber-100 text-amber-700' : 'bg-mint text-fir'}`}>
                  {d.stock}
                </span>
              </div>
            </motion.button>
          ))}
          {(drugs ?? []).length === 0 && (
            <p className="col-span-full text-sm text-ink/50 py-8 text-center">
              Nothing matches “{q}”. Check spelling or add it in Inventory.
            </p>
          )}
        </div>

        {held.length > 0 && (
          <div className="mt-5">
            <p className="text-sm font-semibold text-ink/60 dark:text-mint/60">On hold</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {held.map((h) => (
                <button key={h.id} onClick={() => { recall(h.id); sounds.tap(); }}
                  className="chip bg-mint text-fir border border-mint-deep hover:bg-mint-deep">
                  <PlayCircle className="w-3.5 h-3.5" /> {h.note || new Date(h.at).toLocaleTimeString()}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Cart / tender rail ── */}
      <aside className="card p-4 h-fit lg:sticky lg:top-6">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Current sale</h2>
          {lines.length > 0 && (
            <button className="text-xs text-ink/50 hover:text-red-600 flex items-center gap-1"
              onClick={() => { hold(custName || ''); sounds.tap(); }}>
              <PauseCircle className="w-4 h-4" /> Hold
            </button>
          )}
        </div>

        <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {lines.map((l) => {
              const t = lineTotals(l);
              return (
                <motion.div key={l.drugId} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }} className="flex items-center gap-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{l.name}</p>
                    <p className="text-[11px] text-ink/50">
                      {KES(l.unitPrice)} excl · VAT {KES(t.tax)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="w-7 h-7 rounded-lg bg-mint grid place-items-center" onClick={() => setQty(l.drugId, l.qty - 1)}><Minus className="w-3.5 h-3.5" /></button>
                    <span className="w-6 text-center font-mono">{l.qty}</span>
                    <button className="w-7 h-7 rounded-lg bg-mint grid place-items-center" onClick={() => { setQty(l.drugId, l.qty + 1); sounds.add(); }}><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className="w-20 text-right font-mono">{t.incl.toFixed(0)}</span>
                  <button onClick={() => remove(l.drugId)} className="text-ink/30 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {!lines.length && <p className="text-sm text-ink/40 py-6 text-center">Tap products to add them here.</p>}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <input className="input text-sm" placeholder="Customer (walk-in)" value={custName} onChange={(e) => setCustName(e.target.value)} />
          <input className="input text-sm" placeholder="Buyer KRA PIN (opt.)" value={custPin} onChange={(e) => setCustPin(e.target.value.toUpperCase())} />
        </div>

        <div className="mt-2">
          {discount ? (
            <button className="chip bg-amber-100 text-amber-700 border border-amber-200" onClick={() => setDiscount(null)}>
              <Tag className="w-3.5 h-3.5" /> {discount.type === 'percent' ? `${discount.value}% off` : `${KES(discount.value)} off`} <X className="w-3 h-3" />
            </button>
          ) : discountOpen ? (
            <div className="flex items-center gap-1.5">
              <select className="input text-sm w-24" value={discountType} onChange={(e) => setDiscountType(e.target.value as Discount['type'])}>
                <option value="percent">%</option>
                <option value="amount">KSh</option>
              </select>
              <input className="input text-sm" inputMode="decimal" placeholder="Value" autoFocus
                value={discountValue} onChange={(e) => setDiscountValue(e.target.value.replace(/[^\d.]/g, ''))} />
              <button className="btn-ghost border border-mint-deep px-3 text-sm" onClick={() => {
                const v = Number(discountValue);
                if (v > 0) setDiscount({ type: discountType, value: v });
                setDiscountOpen(false); setDiscountValue('');
              }}>Apply</button>
            </div>
          ) : (
            <button className="text-xs text-ink/50 hover:text-fir flex items-center gap-1" disabled={!lines.length}
              onClick={() => setDiscountOpen(true)}>
              <Tag className="w-3.5 h-3.5" /> Add discount
            </button>
          )}
        </div>

        <div className="mt-3 border-t border-dashed border-mint-deep pt-3 space-y-1 text-sm">
          <p className="flex justify-between text-ink/60"><span>Subtotal (excl. VAT)</span><span className="font-mono">{KES(totals.subtotal)}</span></p>
          <p className="flex justify-between text-ink/60"><span>VAT</span><span className="font-mono">{KES(totals.taxTotal)}</span></p>
          {totals.discountAmount > 0 && (
            <p className="flex justify-between text-amber-600"><span>Discount</span><span className="font-mono">-{KES(totals.discountAmount)}</span></p>
          )}
          <p className="flex justify-between text-lg font-bold"><span>Total</span><span className="font-mono">{KES(totals.total)}</span></p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button className="btn-primary text-sm px-2" disabled={!lines.length} onClick={() => { setPay({ step: 'cash' }); sounds.tap(); }}>
            <Banknote className="w-4 h-4" /> Cash
          </button>
          <button className="btn-leaf text-sm px-2" disabled={!lines.length} onClick={() => { setPay({ step: 'mpesa-phone' }); sounds.tap(); }}>
            <Smartphone className="w-4 h-4" /> M-Pesa
          </button>
          <button className="btn-ghost border border-mint-deep text-sm px-2" disabled={!lines.length || !(providers ?? []).length}
            onClick={() => void openInsurance()}>
            <ShieldPlus className="w-4 h-4" /> Insurance
          </button>
        </div>
      </aside>

      {/* ── Payment / receipt modal ── */}
      <AnimatePresence>
        {pay.step !== 'idle' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4 print:bg-white"
            onClick={() => pay.step !== 'mpesa-wait' && setPay({ step: 'idle' })}>
            <motion.div initial={{ scale: 0.94, y: 10 }} animate={{ scale: 1, y: 0 }}
              className="bg-white dark:bg-[#0c2233] rounded-2xl p-6 w-full max-w-md shadow-lift print:shadow-none"
              onClick={(e) => e.stopPropagation()}>

              {pay.step === 'cash' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-lg">Cash payment</h3>
                  <p className="text-3xl font-mono font-bold text-fir">{KES(totals.total)}</p>
                  <input className="input font-mono text-lg" inputMode="decimal" placeholder="Amount received"
                    value={cashGiven} onChange={(e) => setCashGiven(e.target.value.replace(/[^\d.]/g, ''))} autoFocus />
                  <p className={`text-sm font-mono ${change < 0 ? 'text-red-600' : 'text-fir'}`}>
                    Change: {KES(Math.max(0, change))}
                  </p>
                  <button className="btn-primary w-full" disabled={change < 0 || !cashGiven}
                    onClick={() => void completeSale('cash')}>
                    <CheckCircle2 className="w-4 h-4" /> Complete sale
                  </button>
                </div>
              )}

              {pay.step === 'mpesa-phone' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-lg">Lipa na M-Pesa</h3>
                  <p className="text-3xl font-mono font-bold text-fir">{KES(totals.total)}</p>
                  <input className="input font-mono text-lg" inputMode="tel" placeholder="07XX XXX XXX"
                    value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
                  <button className="btn-leaf w-full" disabled={phone.replace(/\D/g, '').length < 9}
                    onClick={() => void promptMpesa()}>
                    <Smartphone className="w-4 h-4" /> Prompt customer
                  </button>
                  <p className="text-xs text-ink/50">An STK push will pop up on the customer&apos;s phone to confirm.</p>
                </div>
              )}

              {pay.step === 'insurance' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-lg">Bill to insurance</h3>
                  <p className="text-3xl font-mono font-bold text-fir">{KES(totals.total)}</p>
                  <select className="input" value={providerId} onChange={(e) => {
                    setProviderId(e.target.value);
                    const p = (providers ?? []).find((x) => x.id === e.target.value);
                    setCoPay(p ? String(Math.round(totals.total * p.defaultCoPayPercent) / 100) : '');
                  }} autoFocus>
                    <option value="">Select payer…</option>
                    {(providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input className="input" placeholder="Member / policy number" value={memberNo} onChange={(e) => setMemberNo(e.target.value)} />
                  <label className="block text-xs text-ink/50">Co-pay collected from patient now (KES)
                    <input className="input mt-1 font-mono" inputMode="decimal"
                      value={coPay} onChange={(e) => setCoPay(e.target.value.replace(/[^\d.]/g, ''))} />
                  </label>
                  <p className="flex justify-between text-sm text-ink/60 border-t border-dashed border-mint-deep pt-2">
                    <span>Amount claimed from {selectedProvider?.name ?? 'payer'}</span>
                    <span className="font-mono">{KES(Math.max(0, totals.total - (Number(coPay) || 0)))}</span>
                  </p>
                  <button className="btn-primary w-full" disabled={!providerId || !memberNo.trim()}
                    onClick={() => void completeSale('insurance')}>
                    <ShieldPlus className="w-4 h-4" /> Complete sale &amp; file claim
                  </button>
                </div>
              )}

              {pay.step === 'mpesa-wait' && (
                <div className="text-center py-6 space-y-3">
                  <Loader2 className="w-10 h-10 mx-auto animate-spin text-leaf" />
                  <p className="font-semibold">Waiting for customer…</p>
                  <p className="text-sm text-ink/50">Ask them to enter their M-Pesa PIN on the prompt.</p>
                </div>
              )}

              {pay.step === 'failed' && (
                <div className="text-center py-4 space-y-3">
                  <XCircle className="w-10 h-10 mx-auto text-red-500" />
                  <p className="font-semibold">Payment not completed</p>
                  <p className="text-sm text-ink/60">{pay.reason}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button className="btn-ghost border border-mint-deep" onClick={() => setPay({ step: 'idle' })}>Back to sale</button>
                    <button className="btn-leaf" onClick={() => setPay({ step: 'mpesa-phone' })}>Retry M-Pesa</button>
                  </div>
                </div>
              )}

              {pay.step === 'done' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-fir">
                    <CheckCircle2 className="w-6 h-6 text-leaf" />
                    <h3 className="font-bold text-lg">Sale complete</h3>
                  </div>
                  <div className="max-h-[55vh] overflow-y-auto">
                    <Receipt sale={pay.sale} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 print:hidden">
                    <button className="btn-ghost border border-mint-deep" onClick={() => setPay({ step: 'idle' })}>New sale</button>
                    <button className="btn-primary" onClick={() => window.print()}>
                      <Printer className="w-4 h-4" /> Print receipt
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
