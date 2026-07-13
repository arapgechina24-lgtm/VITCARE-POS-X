'use client';
/**
 * Offline-first data layer. IndexedDB (Dexie) is the local source of truth:
 * every read and write hits this store first, so the POS keeps selling with
 * zero connectivity. A sync queue replays mutations to Supabase when online.
 */
import Dexie, { type Table } from 'dexie';
import type {
  AppSettings, AuditEntry, Customer, Drug, InsuranceClaim, InsuranceProvider, OnlineOrder,
  PurchaseOrder, Sale, Supplier, SyncTask,
} from './types';

class VitcareDB extends Dexie {
  drugs!: Table<Drug, string>;
  sales!: Table<Sale, string>;
  orders!: Table<OnlineOrder, string>;
  audit!: Table<AuditEntry, string>;
  syncQueue!: Table<SyncTask, number>;
  settings!: Table<AppSettings, string>;
  customers!: Table<Customer, string>;
  suppliers!: Table<Supplier, string>;
  purchaseOrders!: Table<PurchaseOrder, string>;
  insuranceProviders!: Table<InsuranceProvider, string>;
  insuranceClaims!: Table<InsuranceClaim, string>;

  constructor() {
    super('vitcare');
    this.version(1).stores({
      drugs: 'id, name, genericName, category, barcode, expiryDate, stock',
      sales: 'id, invoiceNo, createdAt, status, synced',
      orders: 'id, status, createdAt, synced',
      audit: 'id, at, synced',
      syncQueue: '++id, table, createdAt',
      settings: 'id',
    });
    this.version(2).stores({
      customers: 'id, name, phone, updatedAt',
      suppliers: 'id, name, updatedAt',
      purchaseOrders: 'id, supplierId, status, createdAt',
    });
    this.version(3).stores({
      insuranceProviders: 'id, name, updatedAt',
      insuranceClaims: 'id, saleId, providerId, status, createdAt',
    });
  }
}

export const db = new VitcareDB();

export const uid = () =>
  (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function getSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('app');
  if (existing) return existing;
  const fresh: AppSettings = {
    id: 'app',
    soundOn: true,
    darkMode: false,
    vatRate: 0.16,
    companyName: process.env.NEXT_PUBLIC_COMPANY_NAME || 'Vitcare Pharmacy and Medical Centre',
    kraPin: process.env.NEXT_PUBLIC_KRA_PIN || 'P051234567X',
    invoiceSeq: 0,
  };
  await db.settings.put(fresh);
  return fresh;
}

/** Sequential eTIMS-style invoice number: VC-YYYYMMDD-0001 */
export async function nextInvoiceNo(): Promise<string> {
  const s = await getSettings();
  const seq = s.invoiceSeq + 1;
  await db.settings.update('app', { invoiceSeq: seq });
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `VC-${ymd}-${String(seq).padStart(4, '0')}`;
}

export async function logAudit(actor: string, action: string, detail: string) {
  const entry: AuditEntry = { id: uid(), actor, action, detail, at: Date.now(), synced: 0 };
  await db.audit.add(entry);
  await db.syncQueue.add({ table: 'audit', op: 'upsert', payload: entry, createdAt: Date.now() });
}

/* ────────────────────────── Seed data (demo mode) ───────────────────────── */

const CATALOG: Array<
  [string, string, string, string, string, number, number, number, number, string]
> = [
  // name, generic, strength, form, manufacturer, price(excl), stock, reorder, taxRate, category
  ['Panadol Advance', 'Paracetamol', '500 mg', 'Tablet', 'GSK', 15, 480, 100, 0, 'Analgesic'],
  ['Brufen', 'Ibuprofen', '400 mg', 'Tablet', 'Abbott', 20, 320, 80, 0, 'Analgesic'],
  ['Amoxil', 'Amoxicillin', '500 mg', 'Capsule', 'GSK', 35, 260, 60, 0, 'Antibiotic'],
  ['Zithromax', 'Azithromycin', '500 mg', 'Tablet', 'Pfizer', 120, 90, 30, 0, 'Antibiotic'],
  ['Augmentin', 'Amoxicillin/Clavulanate', '625 mg', 'Tablet', 'GSK', 95, 140, 40, 0, 'Antibiotic'],
  ['Flagyl', 'Metronidazole', '400 mg', 'Tablet', 'Sanofi', 18, 300, 80, 0, 'Antibiotic'],
  ['Ventolin Inhaler', 'Salbutamol', '100 mcg', 'Inhaler', 'GSK', 650, 42, 15, 0, 'Respiratory'],
  ['Piriton', 'Chlorpheniramine', '4 mg', 'Tablet', 'GSK', 10, 500, 120, 0, 'Antihistamine'],
  ['Cetrizine', 'Cetirizine', '10 mg', 'Tablet', 'Cosmos', 8, 600, 150, 0, 'Antihistamine'],
  ['Losartan H', 'Losartan/HCTZ', '50/12.5 mg', 'Tablet', 'Dawa Ltd', 45, 180, 50, 0, 'Cardiovascular'],
  ['Norvasc', 'Amlodipine', '5 mg', 'Tablet', 'Pfizer', 55, 210, 60, 0, 'Cardiovascular'],
  ['Glucophage', 'Metformin', '500 mg', 'Tablet', 'Merck', 25, 350, 100, 0, 'Diabetes'],
  ['Mixtard 30', 'Insulin (biphasic)', '100 IU/ml', 'Injection', 'Novo Nordisk', 1200, 24, 10, 0, 'Diabetes'],
  ['Buscopan', 'Hyoscine butylbromide', '10 mg', 'Tablet', 'Boehringer', 30, 160, 40, 0, 'GI'],
  ['Omez', 'Omeprazole', '20 mg', 'Capsule', 'Dr Reddy', 22, 280, 70, 0, 'GI'],
  ['ORS Sachets', 'Oral Rehydration Salts', '20.5 g', 'Sachet', 'Cosmos', 25, 400, 100, 0, 'GI'],
  ['Coartem', 'Artemether/Lumefantrine', '20/120 mg', 'Tablet', 'Novartis', 380, 110, 40, 0, 'Antimalarial'],
  ['Duocotecxin', 'DHA/Piperaquine', '40/320 mg', 'Tablet', 'Holley', 420, 70, 25, 0, 'Antimalarial'],
  ['Hydrocortisone Cream', 'Hydrocortisone', '1%', 'Cream', 'Shalina', 150, 85, 25, 0, 'Dermatology'],
  ['Canesten', 'Clotrimazole', '1%', 'Cream', 'Bayer', 320, 60, 20, 0, 'Dermatology'],
  ['Vitamin C Chewable', 'Ascorbic acid', '1000 mg', 'Tablet', 'Haltons', 12, 700, 150, 0.16, 'Supplement'],
  ['Zincovit Syrup', 'Multivitamin + Zinc', '200 ml', 'Syrup', 'Apex', 350, 95, 30, 0.16, 'Supplement'],
  ['Deep Heat Spray', 'Methyl salicylate', '150 ml', 'Spray', 'Mentholatum', 550, 48, 15, 0.16, 'Topical'],
  ['Digital Thermometer', 'Device', 'N/A', 'Device', 'Omron', 450, 35, 10, 0.16, 'Device'],
  ['BP Monitor M2', 'Device', 'N/A', 'Device', 'Omron', 4200, 12, 5, 0.16, 'Device'],
  ['Surgical Masks (50)', 'Consumable', 'N/A', 'Box', 'MedLine', 300, 150, 40, 0.16, 'Consumable'],
  ['Glucose Test Strips', 'Consumable', '50s', 'Box', 'Accu-Chek', 2800, 28, 10, 0.16, 'Consumable'],
  ['Baby Cough Syrup', 'Guaifenesin', '100 ml', 'Syrup', 'Beta Healthcare', 280, 88, 30, 0, 'Paediatric'],
  ['Calpol', 'Paracetamol', '120 mg/5 ml', 'Syrup', 'GSK', 320, 76, 25, 0, 'Paediatric'],
  ['Folic Acid', 'Folic acid', '5 mg', 'Tablet', 'Lab & Allied', 6, 520, 120, 0, 'Supplement'],
];

export async function seedIfEmpty() {
  const count = await db.drugs.count();
  if (count > 0) return;
  const now = Date.now();
  const drugs: Drug[] = CATALOG.map((r, i) => {
    const monthsOut = 3 + ((i * 7) % 30); // staggered expiries, some near-term
    const exp = new Date();
    exp.setMonth(exp.getMonth() + monthsOut);
    return {
      id: uid(),
      name: r[0],
      genericName: r[1],
      strength: r[2],
      dosageForm: r[3],
      manufacturer: r[4],
      batchNumber: `B${2026}${String(100 + i)}`,
      expiryDate: exp.toISOString().slice(0, 10),
      stock: r[6],
      reorderLevel: r[7],
      unitPrice: r[5],
      costPrice: Math.round(r[5] * 0.6 * 100) / 100, // demo margin: ~40% markup
      taxRate: r[8],
      category: r[9],
      barcode: `616${String(1000000000 + i * 137)}`,
      updatedAt: now,
    };
  });
  // Make a few items visibly low / near expiry for the dashboard demo
  drugs[3].stock = 8;
  drugs[12].stock = 4;
  const soon = new Date(); soon.setDate(soon.getDate() + 45);
  drugs[16].expiryDate = soon.toISOString().slice(0, 10);
  await db.drugs.bulkAdd(drugs);
}

const PROVIDERS: Array<[string, InsuranceProvider['payerType'], number]> = [
  ['NHIF / SHA', 'nhif', 0],
  ['KenGen Medical Scheme', 'corporate', 0],
  ['AAR Insurance', 'private', 10],
  ['Jubilee Insurance', 'private', 10],
];

/** Seeds a starter set of payers so the Insurance module is usable out of the box.
 *  Real pharmacies edit/replace these with their actual approved schemes. */
export async function seedInsuranceIfEmpty() {
  const count = await db.insuranceProviders.count();
  if (count > 0) return;
  const now = Date.now();
  await db.insuranceProviders.bulkAdd(PROVIDERS.map(([name, payerType, coPay]) => ({
    id: uid(), name, payerType, defaultCoPayPercent: coPay, createdAt: now, updatedAt: now,
  })));
}
