'use client';
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Search, Pencil, Trash2, X, Send, CheckCircle2, XCircle, Banknote, FileSpreadsheet } from 'lucide-react';
import { db, logAudit, uid } from '@/lib/db';
import { downloadXLS, KES } from '@/lib/utils';
import { CAN, useRole } from '@/lib/role';
import type { ClaimStatus, InsuranceClaim, InsuranceProvider } from '@/lib/types';

const EMPTY: Omit<InsuranceProvider, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', payerType: 'private', contactPerson: '', phone: '', claimEmail: '', defaultCoPayPercent: 0, notes: '',
};

const STATUS_STYLE: Record<ClaimStatus, string> = {
  pending: 'bg-ink/5 text-ink/60',
  submitted: 'bg-amber-50 text-amber-700',
  approved: 'bg-mint text-fir',
  rejected: 'bg-red-50 text-red-600',
  paid: 'bg-leaf/15 text-leaf-soft',
};

export default function InsurancePage() {
  const role = useRole();
  const canManage = CAN.manageInsurance(role);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | 'all'>('all');
  const [editing, setEditing] = useState<InsuranceProvider | 'new' | null>(null);

  const providers = useLiveQuery(() => db.insuranceProviders.orderBy('name').toArray(), [], []);
  const claims = useLiveQuery(() => db.insuranceClaims.orderBy('createdAt').reverse().toArray(), [], []);

  const visible = (claims ?? []).filter((c) =>
    (statusFilter === 'all' || c.status === statusFilter) &&
    (!q.trim() || [c.invoiceNo, c.patientName, c.memberNo, c.providerName].some((f) => f.toLowerCase().includes(q.toLowerCase()))));

  const outstanding = (claims ?? []).filter((c) => c.status !== 'paid' && c.status !== 'rejected');
  const receivablesByProvider = Object.values(
    outstanding.reduce<Record<string, { name: string; amount: number; count: number }>>((m, c) => {
      const cur = m[c.providerId] ?? { name: c.providerName, amount: 0, count: 0 };
      cur.amount += c.approvedAmount ?? c.claimAmount;
      cur.count += 1;
      m[c.providerId] = cur;
      return m;
    }, {}),
  ).sort((a, b) => b.amount - a.amount);
  const totalReceivable = receivablesByProvider.reduce((a, r) => a + r.amount, 0);

  async function saveProvider(p: InsuranceProvider) {
    if (!canManage) return;
    p.updatedAt = Date.now();
    await db.insuranceProviders.put(p);
    await db.syncQueue.add({ table: 'insuranceProviders', op: 'upsert', payload: p, createdAt: Date.now() });
    await logAudit('staff', editing === 'new' ? 'insurance.provider.create' : 'insurance.provider.update', p.name);
    setEditing(null);
  }

  async function delProvider(p: InsuranceProvider) {
    if (!canManage) return;
    if (!confirm(`Delete payer ${p.name}? Existing claims keep their record but won't link to a live payer.`)) return;
    await db.insuranceProviders.delete(p.id);
    await db.syncQueue.add({ table: 'insuranceProviders', op: 'delete', payload: { id: p.id }, createdAt: Date.now() });
    await logAudit('staff', 'insurance.provider.delete', p.name);
  }

  async function updateClaim(c: InsuranceClaim, patch: Partial<InsuranceClaim>, action: string) {
    if (!canManage) return;
    const next = { ...c, ...patch, updatedAt: Date.now() };
    await db.insuranceClaims.put(next);
    await db.syncQueue.add({ table: 'insuranceClaims', op: 'upsert', payload: next, createdAt: Date.now() });
    await logAudit('staff', `claim.${action}`, `${c.invoiceNo} · ${c.providerName} · ${KES(c.claimAmount)}`);
  }

  function submitClaim(c: InsuranceClaim) {
    void updateClaim(c, { status: 'submitted', submittedAt: Date.now() }, 'submitted');
  }
  function approveClaim(c: InsuranceClaim) {
    const raw = prompt(`Approved amount for ${c.invoiceNo} (billed ${KES(c.claimAmount)}):`, String(c.claimAmount));
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0) return;
    void updateClaim(c, { status: 'approved', approvedAmount: amount, respondedAt: Date.now() }, 'approved');
  }
  function rejectClaim(c: InsuranceClaim) {
    const reason = prompt(`Rejection reason for ${c.invoiceNo}:`);
    if (!reason) return;
    void updateClaim(c, { status: 'rejected', rejectionReason: reason, respondedAt: Date.now() }, 'rejected');
  }
  function markPaid(c: InsuranceClaim) {
    void updateClaim(c, { status: 'paid', paidAt: Date.now() }, 'paid');
  }

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold mr-auto">Insurance claims</h1>
        <button className="btn-ghost border border-mint-deep text-sm" onClick={() => downloadXLS('insurance-claims.xls', [
          { title: 'Claims', rows: (claims ?? []).map((c) => ({
            invoice: c.invoiceNo, patient: c.patientName, provider: c.providerName, member_no: c.memberNo,
            claim_amount: c.claimAmount.toFixed(2), co_pay: c.coPayAmount.toFixed(2), status: c.status,
            created: new Date(c.createdAt).toISOString(),
          })) },
        ])}>
          <FileSpreadsheet className="w-4 h-4" /> Export claims
        </button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">Total receivable</p>
          <p className="mt-1 text-xl font-bold font-mono">{KES(totalReceivable)}</p>
        </div>
        {receivablesByProvider.slice(0, 3).map((r) => (
          <div key={r.name} className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50 truncate">{r.name}</p>
            <p className="mt-1 text-xl font-bold font-mono">{KES(r.amount)}</p>
            <p className="text-[11px] text-ink/40">{r.count} claim{r.count === 1 ? '' : 's'} outstanding</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold mr-auto">Payers</h2>
        {canManage && (
          <button className="btn-leaf text-sm" onClick={() => setEditing('new')}><Plus className="w-4 h-4" /> Add payer</button>
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink/50 border-b border-mint-deep">
              <th className="p-3">Payer</th><th className="p-3">Type</th><th className="p-3">Contact</th>
              <th className="p-3 text-right">Default co-pay</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {(providers ?? []).map((p) => (
              <tr key={p.id} className="border-b border-mint/60 hover:bg-mint/40">
                <td className="p-3 font-semibold">{p.name}</td>
                <td className="p-3 text-xs capitalize">{p.payerType}</td>
                <td className="p-3 text-xs text-ink/60">{p.contactPerson}{p.phone ? ` · ${p.phone}` : ''}</td>
                <td className="p-3 text-right font-mono">{p.defaultCoPayPercent}%</td>
                <td className="p-3">
                  {canManage && (
                    <div className="flex justify-end gap-1">
                      <button className="p-2 rounded-lg hover:bg-mint" title="Edit" onClick={() => setEditing(p)}><Pencil className="w-4 h-4 text-ink/60" /></button>
                      <button className="p-2 rounded-lg hover:bg-red-50" title="Delete" onClick={() => void delProvider(p)}><Trash2 className="w-4 h-4 text-red-500" /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {(providers ?? []).length === 0 && <tr><td colSpan={5} className="p-8 text-center text-ink/40">No payers yet — add NHIF, a private insurer, or a corporate scheme like KenGen.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold mr-auto">Claims</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
          <input className="input pl-9" placeholder="Search invoice, patient, member no…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ClaimStatus | 'all')}>
          <option value="all">All statuses</option>
          {(['pending', 'submitted', 'approved', 'rejected', 'paid'] as ClaimStatus[]).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink/50 border-b border-mint-deep">
              <th className="p-3">Invoice</th><th className="p-3">Patient</th><th className="p-3">Payer</th>
              <th className="p-3">Member no.</th><th className="p-3 text-right">Claim</th><th className="p-3 text-right">Co-pay</th>
              <th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id} className="border-b border-mint/60 hover:bg-mint/40">
                <td className="p-3 font-mono">{c.invoiceNo}</td>
                <td className="p-3">{c.patientName}</td>
                <td className="p-3">{c.providerName}</td>
                <td className="p-3 font-mono text-xs">{c.memberNo}</td>
                <td className="p-3 text-right font-mono">{KES(c.approvedAmount ?? c.claimAmount)}</td>
                <td className="p-3 text-right font-mono">{KES(c.coPayAmount)}</td>
                <td className="p-3">
                  <span className={`chip ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                  {c.status === 'rejected' && c.rejectionReason && (
                    <p className="text-[10px] text-red-500 mt-0.5 max-w-[140px] truncate" title={c.rejectionReason}>{c.rejectionReason}</p>
                  )}
                </td>
                <td className="p-3">
                  {canManage && (
                    <div className="flex justify-end gap-1">
                      {c.status === 'pending' && (
                        <button className="btn-ghost border border-mint-deep text-xs" onClick={() => submitClaim(c)}><Send className="w-3.5 h-3.5" /> Submit</button>
                      )}
                      {c.status === 'submitted' && (
                        <>
                          <button className="p-2 rounded-lg hover:bg-mint" title="Approve" onClick={() => approveClaim(c)}><CheckCircle2 className="w-4 h-4 text-leaf" /></button>
                          <button className="p-2 rounded-lg hover:bg-red-50" title="Reject" onClick={() => rejectClaim(c)}><XCircle className="w-4 h-4 text-red-500" /></button>
                        </>
                      )}
                      {c.status === 'approved' && (
                        <button className="btn-ghost border border-mint-deep text-xs" onClick={() => markPaid(c)}><Banknote className="w-3.5 h-3.5" /> Mark paid</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-ink/40">No claims match.</td></tr>}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {editing && <ProviderModal initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={saveProvider} />}
      </AnimatePresence>
    </div>
  );
}

function ProviderModal({ initial, onClose, onSave }: {
  initial: InsuranceProvider | null; onClose: () => void; onSave: (p: InsuranceProvider) => void;
}) {
  const [f, setF] = useState<InsuranceProvider>(initial ?? { ...EMPTY, id: uid(), createdAt: Date.now(), updatedAt: Date.now() });
  const set = <K extends keyof InsuranceProvider>(k: K, v: InsuranceProvider[K]) => setF({ ...f, [k]: v });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }}
        className="bg-white dark:bg-[#0c2233] rounded-2xl p-6 w-full max-w-md shadow-lift" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg">{initial ? `Edit ${initial.name}` : 'Add payer'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-mint"><X className="w-5 h-5" /></button>
        </div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSave(f); }}>
          <input className="input" placeholder="Payer name (e.g. KenGen Medical Scheme) *" required value={f.name} onChange={(e) => set('name', e.target.value)} />
          <select className="input" value={f.payerType} onChange={(e) => set('payerType', e.target.value as InsuranceProvider['payerType'])}>
            <option value="nhif">NHIF / SHA</option>
            <option value="private">Private insurer</option>
            <option value="corporate">Corporate scheme</option>
          </select>
          <input className="input" placeholder="Contact person" value={f.contactPerson ?? ''} onChange={(e) => set('contactPerson', e.target.value)} />
          <input className="input" placeholder="Phone" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          <input className="input" placeholder="Claims email" type="email" value={f.claimEmail ?? ''} onChange={(e) => set('claimEmail', e.target.value)} />
          <label className="block text-xs text-ink/50">Default co-pay (%)
            <input className="input mt-1 font-mono" inputMode="numeric" value={f.defaultCoPayPercent}
              onChange={(e) => set('defaultCoPayPercent', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
          </label>
          <button className="btn-primary w-full">Save payer</button>
        </form>
      </motion.div>
    </motion.div>
  );
}
