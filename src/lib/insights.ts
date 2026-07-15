'use client';
/**
 * Business-insights engine. Every number here is computed deterministically
 * from real Dexie data — nothing is invented. The optional AI layer
 * (/api/insights) only prioritises and narrates this same data; it never
 * generates the underlying facts, so a missing/misconfigured API key can
 * never produce a wrong stock count or a fabricated recommendation.
 */
import { db } from './db';
import { daysUntil, lineTotals } from './utils';
import type { Drug, HealthScore, Recommendation, Sale, ScoreBreakdown } from './types';

export interface BusinessContext {
  generatedAt: number;
  revenue30d: number;
  revenuePrev30d: number;
  profit30d: number;
  transactions30d: number;
  avgBasket30d: number;
  inventoryValue: number;
  totalSkus: number;
  outOfStockSkus: number;
  lowStockSkus: number;
  nearExpirySkus: number;
  deadStockSkus: number;
  topCategories: Array<{ category: string; revenue: number }>;
  topSellers: Array<{ name: string; qty: number; revenue: number }>;
  slowMovers: Array<{ name: string; stock: number; daysSinceLastSale: number | null }>;
  repeatCustomerRate: number;
  totalCustomers: number;
  supplierDebt: number;
  suppliersOverdue: number;
  insuranceReceivable: number;
  insuranceOverdueCount: number;
}

/** Nets a sale's refunds out — same approximation used in Reports. */
function netOf(s: Sale) {
  const refunded = (s.refunds ?? []).reduce((a, r) => a + r.amount, 0);
  const ratio = s.total > 0 ? Math.max(0, (s.total - refunded) / s.total) : 0;
  return { total: s.total - refunded, subtotal: s.subtotal * ratio };
}

export async function computeBusinessContext(): Promise<{ ctx: BusinessContext; drugs: Drug[] }> {
  const now = Date.now();
  const DAY = 86_400_000;
  const [drugs, sales, customers, suppliers, claims] = await Promise.all([
    db.drugs.toArray(),
    db.sales.where('status').anyOf('paid', 'partially_refunded', 'refunded').toArray(),
    db.customers.toArray(),
    db.suppliers.toArray(),
    db.insuranceClaims.toArray(),
  ]);

  const from30 = now - 30 * DAY;
  const fromPrev30 = now - 60 * DAY;
  const sales30 = sales.filter((s) => s.createdAt >= from30);
  const salesPrev30 = sales.filter((s) => s.createdAt >= fromPrev30 && s.createdAt < from30);

  const revenue30d = sales30.reduce((a, s) => a + netOf(s).total, 0);
  const revenuePrev30d = salesPrev30.reduce((a, s) => a + netOf(s).total, 0);
  const cogs30d = sales30.flatMap((s) => s.lines).reduce((a, l) => a + (l.costPrice ?? 0) * l.qty, 0);
  const netRevenueExcl30d = sales30.reduce((a, s) => a + netOf(s).subtotal, 0);
  const profit30d = netRevenueExcl30d - cogs30d;
  const transactions30d = sales30.length;
  const avgBasket30d = transactions30d ? revenue30d / transactions30d : 0;

  const inventoryValue = drugs.reduce((a, d) => a + d.stock * d.unitPrice, 0);
  const totalSkus = drugs.length;
  const outOfStockSkus = drugs.filter((d) => d.stock === 0).length;
  const lowStockSkus = drugs.filter((d) => d.stock > 0 && d.stock <= d.reorderLevel).length;
  const nearExpirySkus = drugs.filter((d) => d.stock > 0 && daysUntil(d.expiryDate) <= 90).length;

  const soldDrugIds = new Set(sales.flatMap((s) => s.lines.map((l) => l.drugId)));
  const deadStockSkus = drugs.filter((d) => d.stock > 0 && !soldDrugIds.has(d.id)).length;

  const catRevenue = new Map<string, number>();
  const sellerAgg = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const s of sales30) {
    for (const l of s.lines) {
      const t = lineTotals(l);
      const cat = drugs.find((d) => d.id === l.drugId)?.category ?? 'Other';
      catRevenue.set(cat, (catRevenue.get(cat) ?? 0) + t.incl);
      const cur = sellerAgg.get(l.drugId) ?? { name: l.name, qty: 0, revenue: 0 };
      cur.qty += l.qty; cur.revenue += t.incl;
      sellerAgg.set(l.drugId, cur);
    }
  }
  const topCategories = Array.from(catRevenue.entries())
    .map(([category, revenue]) => ({ category, revenue }))
    .sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const topSellers = Array.from(sellerAgg.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const lastSaleAt = new Map<string, number>();
  for (const s of sales) {
    for (const l of s.lines) lastSaleAt.set(l.drugId, Math.max(lastSaleAt.get(l.drugId) ?? 0, s.createdAt));
  }
  const slowMovers = drugs
    .filter((d) => d.stock > 0)
    .map((d) => ({
      name: d.name, stock: d.stock,
      daysSinceLastSale: lastSaleAt.has(d.id) ? Math.round((now - lastSaleAt.get(d.id)!) / DAY) : null,
    }))
    .filter((d) => d.daysSinceLastSale === null || d.daysSinceLastSale >= 60)
    .sort((a, b) => (b.daysSinceLastSale ?? 9999) - (a.daysSinceLastSale ?? 9999))
    .slice(0, 8);

  const customerSaleCounts = new Map<string, number>();
  for (const s of sales) {
    const key = s.customerId ?? s.customerPhone;
    if (!key) continue;
    customerSaleCounts.set(key, (customerSaleCounts.get(key) ?? 0) + 1);
  }
  const repeatCustomers = Array.from(customerSaleCounts.values()).filter((n) => n > 1).length;
  const totalTracked = customerSaleCounts.size;
  const repeatCustomerRate = totalTracked ? repeatCustomers / totalTracked : 0;

  const supplierDebt = suppliers.reduce((a, s) => a + s.outstandingBalance, 0);
  const suppliersOverdue = suppliers.filter((s) => s.outstandingBalance > 0).length;

  const outstandingClaims = claims.filter((c) => c.status !== 'paid' && c.status !== 'rejected');
  const insuranceReceivable = outstandingClaims.reduce((a, c) => a + (c.approvedAmount ?? c.claimAmount), 0);
  const insuranceOverdueCount = outstandingClaims.filter((c) => now - c.createdAt >= 14 * DAY).length;

  const ctx: BusinessContext = {
    generatedAt: now, revenue30d, revenuePrev30d, profit30d, transactions30d, avgBasket30d,
    inventoryValue, totalSkus, outOfStockSkus, lowStockSkus, nearExpirySkus, deadStockSkus,
    topCategories, topSellers, slowMovers, repeatCustomerRate, totalCustomers: customers.length,
    supplierDebt, suppliersOverdue, insuranceReceivable, insuranceOverdueCount,
  };
  return { ctx, drugs };
}

function scoreLabel(score: number): HealthScore['label'] {
  if (score >= 85) return 'Excellent';
  if (score >= 65) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

export function inventoryHealthScore(ctx: BusinessContext): HealthScore {
  let score = 100;
  const breakdown: ScoreBreakdown[] = [];

  const stockoutRate = ctx.totalSkus ? ctx.outOfStockSkus / ctx.totalSkus : 0;
  const stockoutPenalty = Math.round(stockoutRate * 40);
  score -= stockoutPenalty;
  breakdown.push({ label: 'Out-of-stock SKUs', value: `${ctx.outOfStockSkus}/${ctx.totalSkus}`, impact: -stockoutPenalty });

  const lowStockPenalty = Math.min(20, ctx.lowStockSkus * 2);
  score -= lowStockPenalty;
  breakdown.push({ label: 'Below reorder level', value: String(ctx.lowStockSkus), impact: -lowStockPenalty });

  const expiryPenalty = Math.min(25, ctx.nearExpirySkus * 3);
  score -= expiryPenalty;
  breakdown.push({ label: 'Expiring within 90 days', value: String(ctx.nearExpirySkus), impact: -expiryPenalty });

  const deadStockPenalty = Math.min(15, ctx.deadStockSkus * 2);
  score -= deadStockPenalty;
  breakdown.push({ label: 'Dead stock (no sales on record)', value: String(ctx.deadStockSkus), impact: -deadStockPenalty });

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: scoreLabel(score), breakdown };
}

export function businessPerformanceScore(ctx: BusinessContext): HealthScore {
  let score = 60;
  const breakdown: ScoreBreakdown[] = [];

  if (ctx.revenuePrev30d > 0) {
    const growth = (ctx.revenue30d - ctx.revenuePrev30d) / ctx.revenuePrev30d;
    const growthImpact = Math.max(-25, Math.min(25, Math.round(growth * 100)));
    score += growthImpact;
    breakdown.push({ label: '30-day revenue trend', value: `${growth >= 0 ? '+' : ''}${(growth * 100).toFixed(0)}%`, impact: growthImpact });
  } else {
    breakdown.push({ label: '30-day revenue trend', value: 'Not enough history yet', impact: 0 });
  }

  const margin = ctx.revenue30d > 0 ? ctx.profit30d / ctx.revenue30d : 0;
  const marginImpact = ctx.revenue30d > 0 ? Math.max(-20, Math.min(20, Math.round((margin - 0.2) * 100))) : 0;
  score += marginImpact;
  breakdown.push({ label: 'Gross margin', value: ctx.revenue30d > 0 ? `${(margin * 100).toFixed(0)}%` : 'No sales yet', impact: marginImpact });

  const receivablesImpact = ctx.insuranceOverdueCount > 0 ? -Math.min(15, ctx.insuranceOverdueCount * 3) : 0;
  score += receivablesImpact;
  breakdown.push({ label: 'Overdue insurance claims (14d+)', value: String(ctx.insuranceOverdueCount), impact: receivablesImpact });

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, label: scoreLabel(score), breakdown };
}

export function generateRecommendations(ctx: BusinessContext, drugs: Drug[]): Recommendation[] {
  const recs: Recommendation[] = [];
  let n = 0;
  const nextId = () => `rec-${++n}`;

  const lowOrOut = drugs.filter((d) => d.stock <= d.reorderLevel)
    .sort((a, b) => a.stock - b.stock).slice(0, 5);
  for (const d of lowOrOut) {
    recs.push({
      id: nextId(), severity: d.stock === 0 ? 'critical' : 'warning', category: 'inventory',
      title: d.stock === 0 ? `${d.name} is out of stock` : `${d.name} is below reorder level`,
      detail: `${d.stock} unit${d.stock === 1 ? '' : 's'} on hand · reorder level ${d.reorderLevel}.`,
      action: 'Raise a purchase order in Suppliers.',
    });
  }

  if (ctx.nearExpirySkus > 0) {
    recs.push({
      id: nextId(), severity: 'warning', category: 'inventory',
      title: `${ctx.nearExpirySkus} product${ctx.nearExpirySkus === 1 ? '' : 's'} expiring within 90 days`,
      detail: 'Unsold near-expiry stock becomes a write-off.',
      action: 'Check Inventory’s "Expiring" filter; consider a discount push or a return to the supplier.',
    });
  }

  if (ctx.deadStockSkus > 0) {
    recs.push({
      id: nextId(), severity: 'info', category: 'inventory',
      title: `${ctx.deadStockSkus} item${ctx.deadStockSkus === 1 ? '' : 's'} in stock with no recorded sales`,
      detail: 'Capital tied up in slow-moving inventory.',
      action: 'Review pricing/placement, or reduce the next reorder quantity for these lines.',
    });
  }

  if (ctx.revenuePrev30d > 0 && ctx.revenue30d < ctx.revenuePrev30d * 0.85) {
    const drop = Math.round((1 - ctx.revenue30d / ctx.revenuePrev30d) * 100);
    recs.push({
      id: nextId(), severity: 'warning', category: 'sales',
      title: `Revenue down ${drop}% vs. the previous 30 days`,
      detail: `KES ${ctx.revenue30d.toFixed(0)} vs. KES ${ctx.revenuePrev30d.toFixed(0)} in the prior period.`,
      action: 'Check for stockouts on top sellers or a seasonal dip before assuming a real decline.',
    });
  }

  if (ctx.supplierDebt > 0) {
    recs.push({
      id: nextId(), severity: ctx.supplierDebt > 100_000 ? 'warning' : 'info', category: 'suppliers',
      title: `KES ${ctx.supplierDebt.toFixed(0)} owed across ${ctx.suppliersOverdue} supplier${ctx.suppliersOverdue === 1 ? '' : 's'}`,
      detail: 'Outstanding purchase-order balances.',
      action: 'Record payments in Suppliers to stay ahead of credit terms.',
    });
  }

  if (ctx.insuranceReceivable > 0) {
    recs.push({
      id: nextId(), severity: ctx.insuranceOverdueCount > 0 ? 'warning' : 'info', category: 'insurance',
      title: `KES ${ctx.insuranceReceivable.toFixed(0)} in unpaid insurance claims`,
      detail: ctx.insuranceOverdueCount > 0
        ? `${ctx.insuranceOverdueCount} claim(s) have been outstanding 14+ days.`
        : 'All claims are within normal processing time.',
      action: 'Follow up with payers on claims older than two weeks — see Insurance claims.',
    });
  }

  if (ctx.totalCustomers > 0 && ctx.transactions30d > 10 && ctx.repeatCustomerRate < 0.2) {
    recs.push({
      id: nextId(), severity: 'info', category: 'customers',
      title: 'Low repeat-customer rate',
      detail: `Only ${(ctx.repeatCustomerRate * 100).toFixed(0)}% of tracked customers have bought more than once.`,
      action: 'Capture more walk-in customers at checkout to build loyalty and enable win-back outreach.',
    });
  }

  if (!recs.length) {
    recs.push({
      id: nextId(), severity: 'info', category: 'inventory',
      title: 'No urgent issues detected',
      detail: 'Inventory, sales and receivables all look within normal ranges for the data recorded so far.',
    });
  }

  const order = { critical: 0, warning: 1, info: 2 };
  return recs.sort((a, b) => order[a.severity] - order[b.severity]);
}
