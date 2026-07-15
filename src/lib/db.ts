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

/* ────────────────────────── Seed catalog ─────────────────────────────────
 * Reference pricing only — researched against typical Kenyan retail pharmacy
 * pricing (Goodlife, MYDAWA and similar) and general market knowledge, not a
 * live scrape (their sites block automated fetches and don't publish full
 * price lists). Treat every unitPrice/costPrice here as a starting point to
 * verify and adjust, not a guaranteed-accurate live quote.
 * All quantities seed at 0 by design — enter real counts from your physical
 * stock take; reorderLevel is pre-set so low-stock alerts work immediately. */

const CATALOG: Array<[string, string, string, string, string, number, number, number, string]> = [
  // name, generic, strength, form, manufacturer, unitPrice(excl VAT), reorderLevel, taxRate, category

  // ── Analgesics / pain & fever ──────────────────────────────────────────
  ['Panadol Advance', 'Paracetamol', '500 mg', 'Tablet', 'GSK', 15, 100, 0, 'Analgesic'],
  ['Panadol Extra', 'Paracetamol/Caffeine', '500/65 mg', 'Tablet', 'GSK', 18, 80, 0, 'Analgesic'],
  ['Hedex', 'Paracetamol', '500 mg', 'Tablet', 'GSK', 14, 100, 0, 'Analgesic'],
  ['Brufen', 'Ibuprofen', '400 mg', 'Tablet', 'Abbott', 20, 80, 0, 'Analgesic'],
  ['Diclofenac', 'Diclofenac sodium', '50 mg', 'Tablet', 'Cosmos', 12, 80, 0, 'Analgesic'],
  ['Tramadol', 'Tramadol HCl', '50 mg', 'Capsule', 'Shelys', 25, 30, 0, 'Analgesic'],
  ['Aspirin', 'Acetylsalicylic acid', '300 mg', 'Tablet', 'Cosmos', 8, 100, 0, 'Analgesic'],
  ['Cardio Aspirin', 'Acetylsalicylic acid', '75 mg', 'Tablet', 'Bayer', 10, 60, 0, 'Cardiovascular'],
  ['Voltaren Gel', 'Diclofenac', '1%', 'Gel', 'Novartis', 480, 15, 0.16, 'Analgesic'],
  ['Diclofenac Injection', 'Diclofenac sodium', '75 mg/3 ml', 'Injection', 'Cosmos', 60, 30, 0, 'Analgesic'],

  // ── Antibiotics ─────────────────────────────────────────────────────────
  ['Amoxil', 'Amoxicillin', '500 mg', 'Capsule', 'GSK', 35, 60, 0, 'Antibiotic'],
  ['Amoxil Syrup', 'Amoxicillin', '125 mg/5 ml', 'Syrup', 'GSK', 280, 25, 0, 'Antibiotic'],
  ['Augmentin', 'Amoxicillin/Clavulanate', '625 mg', 'Tablet', 'GSK', 95, 40, 0, 'Antibiotic'],
  ['Zithromax', 'Azithromycin', '500 mg', 'Tablet', 'Pfizer', 120, 30, 0, 'Antibiotic'],
  ['Flagyl', 'Metronidazole', '400 mg', 'Tablet', 'Sanofi', 18, 80, 0, 'Antibiotic'],
  ['Flagyl Syrup', 'Metronidazole', '200 mg/5 ml', 'Syrup', 'Sanofi', 220, 20, 0, 'Antibiotic'],
  ['Ciprotab', 'Ciprofloxacin', '500 mg', 'Tablet', 'Cosmos', 25, 50, 0, 'Antibiotic'],
  ['Doxycycline', 'Doxycycline', '100 mg', 'Capsule', 'Lab & Allied', 15, 60, 0, 'Antibiotic'],
  ['Erythromycin', 'Erythromycin', '500 mg', 'Tablet', 'Dawa Ltd', 22, 40, 0, 'Antibiotic'],
  ['Septrin', 'Sulfamethoxazole/Trimethoprim', '480 mg', 'Tablet', 'GSK', 12, 60, 0, 'Antibiotic'],
  ['Ceftriaxone Injection', 'Ceftriaxone', '1 g', 'Injection', 'Cosmos', 180, 20, 0, 'Antibiotic'],
  ['Gentamicin Injection', 'Gentamicin', '80 mg/2 ml', 'Injection', 'Cosmos', 45, 25, 0, 'Antibiotic'],

  // ── Antimalarial ────────────────────────────────────────────────────────
  ['Coartem', 'Artemether/Lumefantrine', '20/120 mg', 'Tablet', 'Novartis', 380, 40, 0, 'Antimalarial'],
  ['Duocotecxin', 'DHA/Piperaquine', '40/320 mg', 'Tablet', 'Holley', 420, 25, 0, 'Antimalarial'],
  ['Malarone', 'Atovaquone/Proguanil', '250/100 mg', 'Tablet', 'GSK', 320, 20, 0, 'Antimalarial'],
  ['Quinine Sulphate', 'Quinine', '300 mg', 'Tablet', 'Cosmos', 15, 30, 0, 'Antimalarial'],
  ['Artesunate Injection', 'Artesunate', '60 mg', 'Injection', 'Guilin', 350, 15, 0, 'Antimalarial'],

  // ── Antihistamine / allergy ─────────────────────────────────────────────
  ['Piriton', 'Chlorpheniramine', '4 mg', 'Tablet', 'GSK', 10, 120, 0, 'Antihistamine'],
  ['Cetrizine', 'Cetirizine', '10 mg', 'Tablet', 'Cosmos', 8, 150, 0, 'Antihistamine'],
  ['Loratadine', 'Loratadine', '10 mg', 'Tablet', 'Dawa Ltd', 12, 100, 0, 'Antihistamine'],
  ['Piriton Syrup', 'Chlorpheniramine', '2 mg/5 ml', 'Syrup', 'GSK', 180, 30, 0, 'Antihistamine'],
  ['Phenergan', 'Promethazine', '25 mg', 'Tablet', 'Sanofi', 14, 40, 0, 'Antihistamine'],
  ['Allercet', 'Cetirizine', '10 mg', 'Tablet', 'Beta Healthcare', 9, 100, 0, 'Antihistamine'],

  // ── Cardiovascular ──────────────────────────────────────────────────────
  ['Losartan H', 'Losartan/HCTZ', '50/12.5 mg', 'Tablet', 'Dawa Ltd', 45, 50, 0, 'Cardiovascular'],
  ['Norvasc', 'Amlodipine', '5 mg', 'Tablet', 'Pfizer', 55, 60, 0, 'Cardiovascular'],
  ['Concor', 'Bisoprolol', '5 mg', 'Tablet', 'Merck', 40, 40, 0, 'Cardiovascular'],
  ['Zocor', 'Simvastatin', '20 mg', 'Tablet', 'MSD', 60, 30, 0, 'Cardiovascular'],
  ['Lipitor', 'Atorvastatin', '20 mg', 'Tablet', 'Pfizer', 75, 30, 0, 'Cardiovascular'],
  ['Lasix', 'Furosemide', '40 mg', 'Tablet', 'Sanofi', 15, 40, 0, 'Cardiovascular'],
  ['Aldomet', 'Methyldopa', '250 mg', 'Tablet', 'Dawa Ltd', 20, 30, 0, 'Cardiovascular'],
  ['Digoxin', 'Digoxin', '0.25 mg', 'Tablet', 'Cosmos', 10, 20, 0, 'Cardiovascular'],

  // ── Diabetes ────────────────────────────────────────────────────────────
  ['Glucophage', 'Metformin', '500 mg', 'Tablet', 'Merck', 25, 100, 0, 'Diabetes'],
  ['Diamicron', 'Gliclazide', '80 mg', 'Tablet', 'Servier', 35, 40, 0, 'Diabetes'],
  ['Mixtard 30', 'Insulin (biphasic)', '100 IU/ml', 'Injection', 'Novo Nordisk', 1200, 10, 0, 'Diabetes'],
  ['Lantus', 'Insulin glargine', '100 IU/ml', 'Injection', 'Sanofi', 2400, 8, 0, 'Diabetes'],
  ['Glucometer Strips', 'Blood glucose test strips', '50s', 'Box', 'Accu-Chek', 2800, 10, 0.16, 'Diabetes'],

  // ── GI / antacids ───────────────────────────────────────────────────────
  ['Buscopan', 'Hyoscine butylbromide', '10 mg', 'Tablet', 'Boehringer', 30, 40, 0, 'GI'],
  ['Omez', 'Omeprazole', '20 mg', 'Capsule', 'Dr Reddy', 22, 70, 0, 'GI'],
  ['ORS Sachets', 'Oral Rehydration Salts', '20.5 g', 'Sachet', 'Cosmos', 25, 100, 0, 'GI'],
  ['Eno', 'Sodium bicarbonate/citric acid', '5 g', 'Sachet', 'GSK', 20, 80, 0.16, 'GI'],
  ['Peptang', 'Antacid suspension', '200 ml', 'Syrup', 'Cosmos', 150, 30, 0, 'GI'],
  ['Imodium', 'Loperamide', '2 mg', 'Capsule', 'J&J', 18, 40, 0, 'GI'],
  ['Zantac', 'Ranitidine', '150 mg', 'Tablet', 'GSK', 20, 40, 0, 'GI'],
  ['Duphalac', 'Lactulose', '200 ml', 'Syrup', 'Abbott', 420, 15, 0, 'GI'],

  // ── Respiratory ─────────────────────────────────────────────────────────
  ['Ventolin Inhaler', 'Salbutamol', '100 mcg', 'Inhaler', 'GSK', 650, 15, 0, 'Respiratory'],
  ['Seretide Inhaler', 'Fluticasone/Salmeterol', '25/125 mcg', 'Inhaler', 'GSK', 2200, 8, 0, 'Respiratory'],
  ['Bronchipret Syrup', 'Thyme/Ivy extract', '100 ml', 'Syrup', 'Bayer', 380, 20, 0, 'Respiratory'],
  ['Actifed', 'Triprolidine/Pseudoephedrine', '100 ml', 'Syrup', 'GSK', 260, 25, 0, 'Respiratory'],
  ['Robitussin', 'Guaifenesin/Dextromethorphan', '100 ml', 'Syrup', 'Pfizer', 340, 20, 0, 'Respiratory'],
  ['Amoclan Expectorant', 'Bromhexine', '100 ml', 'Syrup', 'Dawa Ltd', 180, 25, 0, 'Respiratory'],

  // ── Dermatology / topical ──────────────────────────────────────────────
  ['Hydrocortisone Cream', 'Hydrocortisone', '1%', 'Cream', 'Shalina', 150, 25, 0, 'Dermatology'],
  ['Canesten Cream', 'Clotrimazole', '1%', 'Cream', 'Bayer', 320, 20, 0, 'Dermatology'],
  ['Betnovate', 'Betamethasone', '0.1%', 'Cream', 'GSK', 250, 20, 0, 'Dermatology'],
  ['Fucidin', 'Fusidic acid', '2%', 'Cream', 'LEO Pharma', 480, 15, 0, 'Dermatology'],
  ['Calamine Lotion', 'Calamine', '200 ml', 'Lotion', 'Cosmos', 180, 20, 0.16, 'Dermatology'],
  ['Deep Heat Spray', 'Methyl salicylate', '150 ml', 'Spray', 'Mentholatum', 550, 15, 0.16, 'Topical'],
  ['Zambuk Ointment', 'Herbal antiseptic balm', '25 g', 'Ointment', 'Zambuk', 220, 25, 0.16, 'Topical'],

  // ── Antifungal / antiviral ──────────────────────────────────────────────
  ['Diflucan', 'Fluconazole', '150 mg', 'Capsule', 'Pfizer', 180, 20, 0, 'Antifungal'],
  ['Ketoconazole Cream', 'Ketoconazole', '2%', 'Cream', 'Cosmos', 220, 15, 0, 'Antifungal'],
  ['Nystatin Suspension', 'Nystatin', '100,000 IU/ml', 'Suspension', 'Cosmos', 320, 15, 0, 'Antifungal'],
  ['Acyclovir', 'Aciclovir', '400 mg', 'Tablet', 'Cosmos', 25, 25, 0, 'Antiviral'],
  ['Zovirax Cream', 'Aciclovir', '5%', 'Cream', 'GSK', 380, 15, 0, 'Antiviral'],

  // ── Ophthalmic / ENT ────────────────────────────────────────────────────
  ['Chloramphenicol Eye Drops', 'Chloramphenicol', '0.5%', 'Drops', 'Cosmos', 120, 20, 0, 'Ophthalmic'],
  ['Optrex Eye Drops', 'Witch hazel', '10 ml', 'Drops', 'RB', 350, 15, 0.16, 'Ophthalmic'],
  ['Sofradex Ear/Eye Drops', 'Framycetin/Dexamethasone', '5 ml', 'Drops', 'Sanofi', 420, 12, 0, 'Ophthalmic'],
  ['Otex Ear Drops', 'Urea hydrogen peroxide', '10 ml', 'Drops', 'DDD', 380, 12, 0.16, 'ENT'],
  ['Sinutab', 'Paracetamol/Pseudoephedrine', '500/30 mg', 'Tablet', 'J&J', 16, 40, 0, 'ENT'],

  // ── Women's health / contraceptive ──────────────────────────────────────
  ['Microgynon', 'Ethinylestradiol/Levonorgestrel', '30/150 mcg', 'Tablet', 'Bayer', 180, 25, 0, "Women's Health"],
  ['Postinor-2', 'Levonorgestrel', '0.75 mg', 'Tablet', 'Gedeon Richter', 250, 25, 0, "Women's Health"],
  ['Depo-Provera', 'Medroxyprogesterone', '150 mg', 'Injection', 'Pfizer', 450, 15, 0, "Women's Health"],
  ['Canesten Pessary', 'Clotrimazole', '500 mg', 'Pessary', 'Bayer', 280, 15, 0, "Women's Health"],
  ['Folic Acid + Iron', 'Ferrous fumarate/Folic acid', '200/0.4 mg', 'Tablet', 'Lab & Allied', 8, 100, 0, "Women's Health"],
  ['Pregnancy Test Kit', 'hCG rapid test', '1 test', 'Kit', 'Clearblue', 180, 20, 0.16, "Women's Health"],

  // ── Paediatric ──────────────────────────────────────────────────────────
  ['Calpol', 'Paracetamol', '120 mg/5 ml', 'Syrup', 'GSK', 320, 40, 0, 'Paediatric'],
  ['Baby Cough Syrup', 'Guaifenesin', '100 ml', 'Syrup', 'Beta Healthcare', 280, 30, 0, 'Paediatric'],
  ['Nurofen for Children', 'Ibuprofen', '100 mg/5 ml', 'Syrup', 'RB', 420, 25, 0, 'Paediatric'],
  ['Gripe Water', 'Sodium bicarbonate/dill oil', '150 ml', 'Syrup', 'Woodwards', 220, 30, 0.16, 'Paediatric'],
  ['Vermox', 'Mebendazole', '100 mg', 'Tablet', 'J&J', 15, 60, 0, 'Paediatric'],
  ['Zentel Suspension', 'Albendazole', '200 mg/5 ml', 'Suspension', 'GSK', 180, 30, 0, 'Paediatric'],

  // ── Supplements / vitamins ──────────────────────────────────────────────
  ['Vitamin C Chewable', 'Ascorbic acid', '1000 mg', 'Tablet', 'Haltons', 12, 150, 0.16, 'Supplement'],
  ['Zincovit Syrup', 'Multivitamin + Zinc', '200 ml', 'Syrup', 'Apex', 350, 30, 0.16, 'Supplement'],
  ['Folic Acid', 'Folic acid', '5 mg', 'Tablet', 'Lab & Allied', 6, 120, 0, 'Supplement'],
  ['Surbex-Z', 'B-complex + Zinc', '30s', 'Tablet', 'Abbott', 15, 80, 0.16, 'Supplement'],
  ['Berocca', 'Multivitamin effervescent', '10s', 'Tablet', 'Bayer', 45, 40, 0.16, 'Supplement'],
  ['Calcium + Vitamin D3', 'Calcium carbonate/D3', '500 mg', 'Tablet', 'Cosmos', 10, 80, 0.16, 'Supplement'],
  ['Cod Liver Oil Capsules', 'Omega-3', '1000 mg', 'Capsule', 'Seven Seas', 18, 60, 0.16, 'Supplement'],
  ['Iron Tablets', 'Ferrous sulfate', '200 mg', 'Tablet', 'Lab & Allied', 5, 100, 0, 'Supplement'],
  ['Centrum Multivitamin', 'Multivitamin/mineral', '30s', 'Tablet', 'Pfizer', 25, 40, 0.16, 'Supplement'],
  ['Vitamin B Complex', 'B1/B6/B12', '30s', 'Tablet', 'Cosmos', 8, 80, 0, 'Supplement'],

  // ── First aid / wound care ──────────────────────────────────────────────
  ['Elastoplast', 'Adhesive dressing strip', '20s', 'Box', 'Beiersdorf', 220, 30, 0.16, 'First Aid'],
  ['Cotton Wool', 'Absorbent cotton', '100 g', 'Roll', 'MedLine', 120, 30, 0.16, 'First Aid'],
  ['Gauze Bandage', 'Sterile gauze roll', '10 cm', 'Roll', 'MedLine', 60, 40, 0.16, 'First Aid'],
  ['Betadine Solution', 'Povidone iodine', '10%', 'Solution', 'Mundipharma', 380, 20, 0.16, 'First Aid'],
  ['Dettol Antiseptic', 'Chloroxylenol', '250 ml', 'Solution', 'RB', 280, 25, 0.16, 'First Aid'],

  // ── Devices / diagnostics / consumables ─────────────────────────────────
  ['Digital Thermometer', 'N/A', 'N/A', 'Device', 'Omron', 450, 10, 0.16, 'Device'],
  ['BP Monitor M2', 'N/A', 'N/A', 'Device', 'Omron', 4200, 5, 0.16, 'Device'],
  ['Pulse Oximeter', 'N/A', 'N/A', 'Device', 'Yuwell', 1800, 8, 0.16, 'Device'],
  ['Nebulizer Machine', 'N/A', 'N/A', 'Device', 'Omron', 5200, 4, 0.16, 'Device'],
  ['Surgical Masks (50)', 'N/A', 'N/A', 'Box', 'MedLine', 300, 40, 0.16, 'Consumable'],
  ['Latex Gloves (100)', 'N/A', 'N/A', 'Box', 'MedLine', 850, 20, 0.16, 'Consumable'],
  ['Syringes 5ml (100)', 'N/A', 'N/A', 'Box', 'Terumo', 950, 15, 0.16, 'Consumable'],
  ['Hand Sanitizer', 'Ethyl alcohol 70%', '500 ml', 'Bottle', 'Dettol', 320, 30, 0.16, 'Consumable'],

  // ── Oral care ────────────────────────────────────────────────────────────
  ['Bongela Gel', 'Choline salicylate', '15 g', 'Gel', 'GSK', 380, 15, 0, 'Oral Care'],
  ['Difflam Mouthwash', 'Benzydamine', '200 ml', 'Solution', 'Sandoz', 420, 15, 0.16, 'Oral Care'],
  ['Strepsils', 'Antiseptic lozenges', '24s', 'Lozenge', 'RB', 280, 30, 0.16, 'Oral Care'],
];

const PLACEHOLDER_EXPIRY_MONTHS = 24; // reference expiry until a real stock take supplies batch data

export async function seedIfEmpty() {
  const count = await db.drugs.count();
  if (count > 0) return;
  const now = Date.now();
  const exp = new Date();
  exp.setMonth(exp.getMonth() + PLACEHOLDER_EXPIRY_MONTHS);
  const expiryDate = exp.toISOString().slice(0, 10);

  const drugs: Drug[] = CATALOG.map((r, i) => ({
    id: uid(),
    name: r[0],
    genericName: r[1],
    strength: r[2],
    dosageForm: r[3],
    manufacturer: r[4],
    batchNumber: 'PENDING-STOCKTAKE',
    expiryDate,
    stock: 0, // populate from your physical stock take, not a demo count
    reorderLevel: r[6],
    unitPrice: r[5],
    costPrice: Math.round(r[5] * 0.6 * 100) / 100, // ~40% markup placeholder — replace with real supplier cost
    taxRate: r[7],
    category: r[8],
    barcode: `616${String(1000000000 + i * 137)}`,
    updatedAt: now,
  }));
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
