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
 *  1. Staff enter their work email; Supabase emails a one-time code (length is
 *     a project-level Auth setting, not assumed here — see the OTP input below).
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
      try {
        await logAudit(email || 'demo', 'login', `Demo-mode sign-in as ${role}`);
      } catch (auditErr) {
        console.warn('[login] audit log write failed (non-blocking)', auditErr);
      }
      r.push('/dashboard');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) { setErr(error.message); return; }
      setStage('otp');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong sending the code — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setErr('');
    try {
      // The real auth check — if this fails, that's the only thing worth blocking on.
      const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
      if (error) { setErr('Invalid or expired code — try again.'); setBusy(false); return; }

      // Everything below is best-effort: the user is already authenticated at
      // this point, so a hiccup in the MFA-factor check or the local audit
      // write (e.g. stale IndexedDB from earlier Demo Mode use) must never
      // strand a successfully-logged-in user on this screen.
      try {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.[0];
        if (totp) { setFactorId(totp.id); setStage('mfa'); setBusy(false); return; }
      } catch (mfaErr) {
        console.warn('[login] MFA factor check failed, continuing without it', mfaErr);
      }
      try {
        await logAudit(email, 'login', 'Signed in via email OTP');
      } catch (auditErr) {
        console.warn('[login] audit log write failed (non-blocking)', auditErr);
      }
      // Success — deliberately leave busy=true (button stays disabled/shows
      // "Verifying…") while the route transition to /dashboard is in flight.
      // Resetting it here would briefly re-enable the form on the still-visible
      // login page, inviting an impatient extra click that resubmits the
      // now-consumed (single-use) OTP code and surfaces a confusing error.
      r.push('/dashboard');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong verifying the code — try again.');
      setBusy(false);
    }
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setErr('');
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr || !ch) { setErr(chErr?.message ?? 'Challenge failed'); setBusy(false); return; }
      const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: totpCode });
      if (error) { setErr('Invalid code — try again.'); setBusy(false); return; }
      try {
        await logAudit(email, 'login', 'MFA verified (TOTP) after email OTP');
      } catch (auditErr) {
        console.warn('[login] audit log write failed (non-blocking)', auditErr);
      }
      // Success — leave busy=true through the redirect; see verifyOtp for why.
      r.push('/dashboard');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong — try again.');
      setBusy(false);
    }
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
                No password needed — we&apos;ll email you a one-time code. Only accounts an admin has already added can sign in.
              </p>
            )}
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={verifyOtp} className="mt-6 space-y-3">
            <div className="flex items-center gap-2 text-sm text-fir">
              <Mail className="w-4 h-4" /> Enter the code we emailed to {email}.
            </div>
            {/* Supabase's OTP length is configurable (Authentication → Emails) and
                isn't guaranteed to be 6 — accept whatever length is actually sent
                rather than hardcoding one, and let verifyOtp be the real validator. */}
            <input className="input text-center tracking-[0.3em] font-mono text-lg" inputMode="numeric"
              maxLength={10} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button className="btn-primary w-full" disabled={busy || otp.length < 6}>
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
