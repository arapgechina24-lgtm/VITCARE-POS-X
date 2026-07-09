/** Core domain types — shared by the offline store, Supabase sync and UI. */

export type Role = 'admin' | 'pharmacist' | 'viewer';

export interface Drug {
  id: string;
  name: string;
  genericName: string;
  strength: string;         // e.g. "500 mg"
  dosageForm: string;       // Tablet, Syrup, Capsule…
  manufacturer: string;
  batchNumber: string;
  expiryDate: string;       // ISO date
  stock: number;
  reorderLevel: number;
  unitPrice: number;        // KES, VAT-exclusive
  taxRate: number;          // 0 or 0.16 (VAT). Most human medicines in KE are zero-rated.
  category: string;
  barcode: string;
  notes?: string;
  updatedAt: number;        // epoch ms — last-write-wins sync key
}

export interface CartLine {
  drugId: string;
  name: string;
  strength: string;
  qty: number;
  unitPrice: number;        // excl. tax
  taxRate: number;
}

export type PaymentMethod = 'cash' | 'mpesa' | 'card' | 'mobile_money';
export type PaymentStatus = 'pending' | 'paid' | 'failed';

export interface Sale {
  id: string;
  invoiceNo: string;        // eTIMS-style sequential invoice number
  lines: CartLine[];
  subtotal: number;         // excl. tax
  taxTotal: number;
  total: number;            // incl. tax
  method: PaymentMethod;
  status: PaymentStatus;
  customerName?: string;
  customerPhone?: string;
  customerPin?: string;     // buyer KRA PIN (optional, eTIMS)
  mpesaRef?: string;
  cashierId?: string;
  createdAt: number;
  synced: 0 | 1;
  etims?: EtimsStamp;
}

/** Fields eTIMS (OSCU/VSCU) stamps onto a fiscalised invoice. Populated by the
 *  KRA control unit in production; placeholders in demo mode. */
export interface EtimsStamp {
  scuId: string;            // Sales Control Unit ID
  receiptSignature: string; // control-unit signature
  internalData: string;
  verifyUrl: string;        // QR target on itax
}

export interface OnlineOrder {
  id: string;
  customerName: string;
  customerPhone: string;
  lines: CartLine[];
  total: number;
  status: 'new' | 'fulfilled' | 'rejected';
  createdAt: number;
  synced: 0 | 1;
}

export interface SyncTask {
  id?: number;
  table: 'drugs' | 'sales' | 'orders' | 'audit';
  op: 'upsert' | 'delete';
  payload: unknown;
  createdAt: number;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  detail: string;
  at: number;
  synced: 0 | 1;
}

export interface AppSettings {
  id: 'app';
  soundOn: boolean;
  darkMode: boolean;
  vatRate: number;
  companyName: string;
  kraPin: string;
  invoiceSeq: number;
}
