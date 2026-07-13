'use client';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Cross, ShieldCheck, WifiOff, Smartphone } from 'lucide-react';

const NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || 'Vitcare Pharmacy and Medical Centre';
const TAGLINE = process.env.NEXT_PUBLIC_COMPANY_TAGLINE || 'Your Trusted Pharmacy Partner in Naivasha';

export default function Splash() {
  return (
    <main className="min-h-dvh bg-fir-deep text-white flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* ambient glow */}
      <div className="absolute -top-40 -right-40 w-[36rem] h-[36rem] rounded-full bg-leaf/10 blur-3xl" />
      <div className="absolute -bottom-52 -left-40 w-[36rem] h-[36rem] rounded-full bg-leaf/10 blur-3xl" />

      <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }}
        className="w-20 h-20 rounded-3xl bg-leaf flex items-center justify-center shadow-lift">
        <Cross className="w-10 h-10 text-fir-deep" strokeWidth={2.5} />
      </motion.div>

      <motion.h1 initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
        className="mt-6 text-4xl md:text-5xl font-display font-extrabold tracking-tight text-center">
        Vitcare <span className="text-leaf-soft">POS</span>
      </motion.h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}
        className="mt-2 text-mint/80 text-center">{NAME}</motion.p>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
        className="text-sm text-mint/60 text-center">{TAGLINE}</motion.p>

      {/* Signature: vitals pulse */}
      <svg viewBox="0 0 320 40" className="mt-8 w-72 text-leaf" fill="none" aria-hidden>
        <path className="pulse-line" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          d="M0 20 H90 l10 -12 12 24 10 -18 8 6 H210 l8 -8 10 16 8 -8 H320" />
      </svg>

      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.9 }}
        className="mt-10 flex flex-col sm:flex-row gap-3">
        <Link href="/login" className="btn bg-leaf text-fir-deep hover:bg-leaf-soft px-8 py-3 text-base shadow-lift">
          Open the till
        </Link>
        <Link href="/shop" className="btn border border-mint/30 text-mint hover:bg-white/5 px-8 py-3 text-base">
          Customer shop
        </Link>
      </motion.div>

      <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}
        className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-3 text-xs text-mint/70">
        <li className="flex items-center gap-1.5"><WifiOff className="w-3.5 h-3.5" /> Sells fully offline</li>
        <li className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> MFA &amp; role-based access</li>
        <li className="flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> Installs like an app</li>
      </motion.ul>
    </main>
  );
}
