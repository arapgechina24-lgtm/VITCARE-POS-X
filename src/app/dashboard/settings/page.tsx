'use client';
import { useEffect, useState } from 'react';
import { Volume2, VolumeX, Moon, Sun, ShieldCheck, DatabaseZap, QrCode } from 'lucide-react';
import { db, getSettings, seedIfEmpty } from '@/lib/db';
import { setSoundEnabled, sounds } from '@/lib/sounds';
import { isDemoMode, supabase } from '@/lib/supabase';
import type { AppSettings } from '@/lib/types';

export default function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [mfaQr, setMfaQr] = useState<string | null>(null);
  const [mfaMsg, setMfaMsg] = useState('');

  useEffect(() => { void getSettings().then(setS); }, []);

  async function update(patch: Partial<AppSettings>) {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    await db.settings.put(next);
    if (patch.soundOn !== undefined) { setSoundEnabled(patch.soundOn); if (patch.soundOn) sounds.tap(); }
    if (patch.darkMode !== undefined) document.documentElement.classList.toggle('dark', patch.darkMode);
  }

  /** Enrol a TOTP factor (Google Authenticator, Authy…) on the signed-in account. */
  async function enrollMfa() {
    if (!supabase) { setMfaMsg('MFA enrolment needs a connected Supabase project.'); return; }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (error || !data) { setMfaMsg(error?.message ?? 'Enrolment failed'); return; }
    setMfaQr(data.totp.qr_code); // SVG data-URI to scan
    setMfaMsg('Scan with your authenticator app, then verify on next sign-in.');
  }

  async function resetDemoData() {
    if (!confirm('Wipe local data and reseed the demo catalog?')) return;
    await db.delete();
    await db.open();
    await seedIfEmpty();
    location.reload();
  }

  if (!s) return null;

  return (
    <div className="max-w-2xl space-y-6 animate-rise">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold">Company &amp; tax</h2>
        <label className="block text-xs text-ink/50">Company name
          <input className="input mt-1" value={s.companyName} onChange={(e) => void update({ companyName: e.target.value })} />
        </label>
        <label className="block text-xs text-ink/50">KRA PIN (appears on invoices)
          <input className="input mt-1 font-mono" value={s.kraPin} onChange={(e) => void update({ kraPin: e.target.value.toUpperCase() })} />
        </label>
        <label className="block text-xs text-ink/50">Standard VAT rate
          <select className="input mt-1" value={s.vatRate} onChange={(e) => void update({ vatRate: Number(e.target.value) })}>
            <option value={0.16}>16%</option>
            <option value={0.08}>8%</option>
          </select>
        </label>
      </section>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold">Experience</h2>
        <Toggle
          icon={s.soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          label="Sound feedback" hint="Chimes on sale, beeps on scan"
          on={s.soundOn} onChange={(v) => void update({ soundOn: v })} />
        <Toggle
          icon={s.darkMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          label="Dark mode" hint="Easier on the eyes for evening shifts"
          on={s.darkMode} onChange={(v) => void update({ darkMode: v })} />
      </section>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-leaf" /> Security</h2>
        <p className="text-sm text-ink/60">
          Two-factor authentication adds a 6-digit authenticator code to every sign-in.
          {isDemoMode && ' (Connect Supabase to enable — see README.)'}
        </p>
        <button className="btn-primary text-sm" onClick={() => void enrollMfa()} disabled={isDemoMode}>
          <QrCode className="w-4 h-4" /> Enrol authenticator app
        </button>
        {mfaQr && <img src={mfaQr} alt="Scan this QR with your authenticator app" className="w-40 h-40 bg-white p-2 rounded-xl" />}
        {mfaMsg && <p className="text-xs text-ink/50">{mfaMsg}</p>}
      </section>

      <section className="card p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><DatabaseZap className="w-4 h-4 text-amber-500" /> Data</h2>
        <p className="text-sm text-ink/60">Local data lives in this device&apos;s IndexedDB and syncs to the server when connected.</p>
        <button className="btn-ghost border border-red-200 text-red-600 text-sm" onClick={() => void resetDemoData()}>
          Reset local data &amp; reseed demo catalog
        </button>
      </section>
    </div>
  );
}

function Toggle({ icon, label, hint, on, onChange }: {
  icon: React.ReactNode; label: string; hint: string; on: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button className="w-full flex items-center gap-3 text-left" onClick={() => onChange(!on)}>
      <span className="text-fir">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-ink/50">{hint}</span>
      </span>
      <span className={`w-11 h-6 rounded-full p-0.5 transition ${on ? 'bg-leaf' : 'bg-ink/20'}`}>
        <span className={`block w-5 h-5 rounded-full bg-white transition ${on ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}
