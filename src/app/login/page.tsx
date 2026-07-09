'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Cross, KeyRound, ShieldCheck } from 'lucide-react';
import { isDemoMode, supabase } from '@/lib/supabase';
import { logAudit } from '@/lib/db';

/**
 * Authentication flow:
 *  1. email + password via Supabase Auth
 *  2. if the account has an enrolled TOTP factor, a 6-digit MFA challenge
 *     (aal2) is required before the session is usable.
 * Demo Mode (no Supabase configured) offers a clearly labelled local sign-in
 * so evaluators can explore the full POS.
 */
export default function Login() {
  const r = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'creds' | 'mfa'>('creds');
  const [factorId, setFactorId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (isDemoMode || !supabase) {
      sessionStorage.setItem('vitcare-demo-user', email || 'demo@vitcare.co.ke');
      await logAudit(email || 'demo', 'login', 'Demo-mode sign-in');
      r.push('/dashboard');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setErr(error.message); setBusy(false); return; }

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.[0];
    if (totp) { setFactorId(totp.id); setStage('mfa'); setBusy(false); return; }
    await logAudit(email, 'login', 'Password sign-in (no MFA enrolled)');
    r.push('/dashboard');
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setErr('');
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr || !ch) { setErr(chErr?.message ?? 'Challenge failed'); setBusy(false); return; }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code });
    if (error) { setErr('Invalid code — try again.'); setBusy(false); return; }
    await logAudit(email, 'login', 'MFA verified (TOTP)');
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

        {stage === 'creds' ? (
          <form onSubmit={signIn} className="mt-6 space-y-3">
            <input className="input" type="email" placeholder="Work email" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="username" required={!isDemoMode} />
            <input className="input" type="password" placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required={!isDemoMode} />
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              <KeyRound className="w-4 h-4" /> {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {isDemoMode && (
              <p className="text-xs text-center text-ink/50 pt-1">
                Demo Mode — no server configured. Any email opens a local session; data stays on this device.
              </p>
            )}
          </form>
        ) : (
          <form onSubmit={verifyMfa} className="mt-6 space-y-3">
            <div className="flex items-center gap-2 text-sm text-fir">
              <ShieldCheck className="w-4 h-4" /> Enter the 6-digit code from your authenticator app.
            </div>
            <input className="input text-center tracking-[0.4em] font-mono text-lg" inputMode="numeric"
              maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button className="btn-primary w-full" disabled={busy || code.length !== 6}>Verify</button>
          </form>
        )}
      </motion.div>
    </main>
  );
}
