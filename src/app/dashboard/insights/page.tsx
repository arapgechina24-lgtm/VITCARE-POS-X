'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles, AlertTriangle, Info, AlertCircle, TrendingUp, TrendingDown,
  Loader2, RefreshCw,
} from 'lucide-react';
import {
  computeBusinessContext, businessPerformanceScore, inventoryHealthScore, generateRecommendations,
  type BusinessContext,
} from '@/lib/insights';
import { KES } from '@/lib/utils';
import { CAN, useRole } from '@/lib/role';
import type { HealthScore, Recommendation } from '@/lib/types';

interface Briefing { headline: string; narrative: string; focusAreas: string[] }

const SEVERITY_ICON = { critical: AlertCircle, warning: AlertTriangle, info: Info };
const SEVERITY_STYLE = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  info: 'border-mint-deep bg-mint text-fir',
};

export default function InsightsPage() {
  const role = useRole();
  const [ctx, setCtx] = useState<BusinessContext | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [inv, setInv] = useState<HealthScore | null>(null);
  const [biz, setBiz] = useState<HealthScore | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [briefingState, setBriefingState] = useState<'idle' | 'loading' | 'unavailable'>('idle');

  async function load() {
    const { ctx: c, drugs } = await computeBusinessContext();
    setCtx(c);
    setInv(inventoryHealthScore(c));
    setBiz(businessPerformanceScore(c));
    setRecs(generateRecommendations(c, drugs));
  }

  useEffect(() => { void load(); }, []);

  async function askVita() {
    if (!ctx) return;
    setBriefingState('loading');
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx, recommendations: recs }),
      });
      const j = await res.json();
      if (j.fallback || !j.headline) { setBriefingState('unavailable'); return; }
      setBriefing(j);
      setBriefingState('idle');
    } catch {
      setBriefingState('unavailable');
    }
  }

  if (!CAN.viewReports(role)) {
    return (
      <div className="animate-rise">
        <h1 className="text-2xl font-bold">Business insights</h1>
        <p className="mt-3 text-sm text-ink/50">Only administrators and pharmacists can view business insights.</p>
      </div>
    );
  }

  if (!ctx || !inv || !biz) return null;

  return (
    <div className="space-y-6 animate-rise">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold mr-auto">Business insights</h1>
        <button className="btn-ghost border border-mint-deep text-sm" onClick={() => void load()}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* AI briefing */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <p className="font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4 text-leaf" /> Vita's weekly briefing</p>
          <button className="btn-leaf text-sm" disabled={briefingState === 'loading'} onClick={() => void askVita()}>
            {briefingState === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {briefing ? 'Regenerate' : 'Generate briefing'}
          </button>
        </div>
        {briefing ? (
          <div className="mt-3 space-y-2">
            <p className="font-semibold text-fir">{briefing.headline}</p>
            <p className="text-sm text-ink/70">{briefing.narrative}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {briefing.focusAreas.map((f, i) => <li key={i} className="flex gap-2"><span className="text-leaf">→</span>{f}</li>)}
            </ul>
          </div>
        ) : briefingState === 'unavailable' ? (
          <p className="mt-3 text-sm text-ink/50">
            No AI briefing available (set <code className="font-mono">ANTHROPIC_API_KEY</code> to enable it). The deterministic recommendations below still reflect your real data.
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink/50">Generate a plain-English weekly summary — built entirely from the figures on this page, never invented.</p>
        )}
      </div>

      {/* Health scores */}
      <div className="grid md:grid-cols-2 gap-4">
        <ScoreCard title="Inventory health" score={inv} />
        <ScoreCard title="Business performance" score={biz} />
      </div>

      {/* Recommendations */}
      <div className="card p-5">
        <p className="font-semibold">Recommendations</p>
        <div className="mt-3 space-y-2">
          {recs.map((r) => {
            const Icon = SEVERITY_ICON[r.severity];
            return (
              <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className={`rounded-xl border p-3 text-sm ${SEVERITY_STYLE[r.severity]}`}>
                <p className="font-semibold flex items-center gap-1.5"><Icon className="w-4 h-4 shrink-0" /> {r.title}</p>
                <p className="mt-0.5 opacity-90">{r.detail}</p>
                {r.action && <p className="mt-1 text-xs opacity-75">→ {r.action}</p>}
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Wider analytics */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <p className="font-semibold">Revenue trend (30d vs. prior 30d)</p>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-2xl font-bold font-mono">{KES(ctx.revenue30d)}</span>
            {ctx.revenuePrev30d > 0 && (
              <span className={`chip ${ctx.revenue30d >= ctx.revenuePrev30d ? 'bg-mint text-fir' : 'bg-red-50 text-red-600'}`}>
                {ctx.revenue30d >= ctx.revenuePrev30d ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {ctx.revenuePrev30d > 0 ? `${Math.round(((ctx.revenue30d - ctx.revenuePrev30d) / ctx.revenuePrev30d) * 100)}%` : '—'}
              </span>
            )}
          </div>
          <p className="text-xs text-ink/40 mt-1">Prior 30 days: {KES(ctx.revenuePrev30d)} · {ctx.transactions30d} transactions · avg basket {KES(ctx.avgBasket30d)}</p>

          <p className="font-semibold mt-5">Top categories (30d)</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {ctx.topCategories.map((c) => (
              <li key={c.category} className="flex justify-between"><span>{c.category}</span><span className="font-mono">{KES(c.revenue)}</span></li>
            ))}
            {!ctx.topCategories.length && <li className="text-ink/40">No category sales in the last 30 days.</li>}
          </ul>
        </div>

        <div className="card p-5">
          <p className="font-semibold">Slow movers (in stock, 60d+ without a sale)</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {ctx.slowMovers.map((d) => (
              <li key={d.name} className="flex justify-between gap-2">
                <span className="truncate">{d.name}</span>
                <span className="text-ink/50 font-mono text-xs">
                  {d.stock} in stock · {d.daysSinceLastSale === null ? 'never sold' : `${d.daysSinceLastSale}d ago`}
                </span>
              </li>
            ))}
            {!ctx.slowMovers.length && <li className="text-ink/40">Nothing looks slow-moving right now.</li>}
          </ul>

          <p className="font-semibold mt-5">Customers &amp; receivables</p>
          <div className="mt-2 space-y-1 text-sm">
            <p className="flex justify-between"><span className="text-ink/50">Repeat-customer rate</span><span className="font-mono">{(ctx.repeatCustomerRate * 100).toFixed(0)}%</span></p>
            <p className="flex justify-between"><span className="text-ink/50">Supplier balances owed</span><span className="font-mono">{KES(ctx.supplierDebt)}</span></p>
            <p className="flex justify-between"><span className="text-ink/50">Insurance receivables</span><span className="font-mono">{KES(ctx.insuranceReceivable)}</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreCard({ title, score }: { title: string; score: HealthScore }) {
  const color = score.score >= 85 ? 'text-leaf' : score.score >= 65 ? 'text-fir' : score.score >= 40 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{title}</p>
        <span className={`text-2xl font-bold font-mono ${color}`}>{score.score}</span>
      </div>
      <p className={`text-sm font-semibold ${color}`}>{score.label}</p>
      <ul className="mt-3 space-y-1 text-xs">
        {score.breakdown.map((b) => (
          <li key={b.label} className="flex justify-between text-ink/60">
            <span>{b.label}</span>
            <span className="font-mono">{b.value} {b.impact !== 0 && <span className={b.impact > 0 ? 'text-leaf' : 'text-red-500'}>({b.impact > 0 ? '+' : ''}{b.impact})</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
