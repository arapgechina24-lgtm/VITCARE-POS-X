'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Cross, Mail, ShieldCheck, KeyRound } from 'lucide-react';
import { isDemoMode, supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/db';
import { ROLE_LABEL, setDemoRole } from '@/lib/role';
import type { Role } from '@/lib/types';

/**
 * Authentication flow (Connected Mode — passwordless):
 *  1. Staff enter their work email; Supabase emails a 6-digit one-time code.
 *     `shouldCreateUser: false` means only accounts an admin has already
 *     provisioned (see supabase/schema.sql) can sign in — no open self-signup.
 *  2. Entering the correct code signs them in.
 *  3. If the account also has an enrolled authenticator app (Settings → MFA),
 *     a second 6-digit TOTP challenge is required before the session is usable.
 * Demo Mode (no Supabase configured) offers a clearly labelled local sign-in
 * with a role picker so evaluators can explore the full POS without email.
 */
export default function Login() {
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('cashier');
  const [otp, setOtp] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [stage, setStage] = useState<'email' | 'otp' | 'mfa'>('email');
  const [factorId, setFactorId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (isDemoMode || !supabase) {
      sessionStorage.setItem('vitcare-demo-user', email || 'demo@vitcare.co.ke');
      setDemoRole(role);
      await logAudit(email || 'demo', 'login', `Demo-mode sign-in as ${role}`);
      r.push('/dashboard');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setStage('otp');
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setErr('');
    const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
    if (error) { setErr('Invalid or expired code — try again.'); setBusy(false); return; }

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.[0];
    if (totp) { setFactorId(totp.id); setStage('mfa'); setBusy(false); return; }
    await logAudit(email, 'login', 'Signed in via email OTP');
    r.push('/dashboard');
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setErr('');
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr || !ch) { setErr(chErr?.message ?? 'Challenge failed'); setBusy(false); return; }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: totpCode });
    if (error) { setErr('Invalid code — try again.'); setBusy(false); return; }
    await logAudit(email, 'login', 'MFA verified (TOTP) after email OTP');
    r.push('/dashboard');
  }

  return (
    <main className="min-h-dvh grid place-items-center bg-mint px-4">
      <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="card w-full max-w-md p-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-fir grid place-items-center">
            <Cross className="w-6 h-6 text-leaf-soft" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Vitcare POS</h1>
            <p className="text-xs text-ink/60">Staff sign-in</p>
          </div>
        </div>

        {stage === 'email' && (
          <form onSubmit={requestOtp} className="mt-6 space-y-3">
            <input className="input" type="email" placeholder="Work email" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
            {isDemoMode && (
              <label className="block text-xs text-ink/50">Sign in as
                <select className="input mt-1" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </label>
            )}
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              <Mail className="w-4 h-4" /> {busy ? 'Sending code…' : isDemoMode ? 'Sign in' : 'Send me a code'}
            </button>
            {isDemoMode ? (
              <p className="text-xs text-center text-ink/50 pt-1">
                Demo Mode — no server configured. Any email opens a local session; data stays on this device.
              </p>
            ) : (
              <p className="text-xs text-center text-ink/50 pt-1">
                No password needed — we&apos;ll email a 6-digit code. Only accounts an admin has already added can sign in.
              </p>
            )}
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={verifyOtp} className="mt-6 space-y-3">
            <div className="flex items-center gap-2 text-sm text-fir">
              <Mail className="w-4 h-4" /> Enter the 6-digit code we emailed to {email}.
            </div>
            <input className="input text-center tracking-[0.4em] font-mono text-lg" inputMode="numeric"
              maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button className="btn-primary w-full" disabled={busy || otp.length !== 6}>
              <KeyRound className="w-4 h-4" /> {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <button type="button" className="text-xs text-ink/50 hover:text-fir w-full text-center"
              onClick={() => { setStage('email'); setOtp(''); setErr(''); }}>
              Use a different email
            </button>
          </form>
        )}

        {stage === 'mfa' && (
          <form onSubmit={verifyMfa} className="mt-6 space-y-3">
            <div className="flex items-center gap-2 text-sm text-fir">
              <ShieldCheck className="w-4 h-4" /> This account also requires your authenticator app code.
            </div>
            <input className="input text-center tracking-[0.4em] font-mono text-lg" inputMode="numeric"
              maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button className="btn-primary w-full" disabled={busy || totpCode.length !== 6}>Verify</button>
          </form>
        )}
      </motion.div>
    </main>
  );
}
