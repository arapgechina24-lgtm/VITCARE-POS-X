/** Core domain types — shared by the offline store, Supabase sync and UI. */

export type Role = 'admin' | 'pharmacist' | 'cashier';

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
  unitPrice: number;        // KES, VAT-exclusive selling price
  costPrice: number;        // KES, VAT-exclusive purchase price — drives profit reporting
  taxRate: number;          // 0 or 0.16 (VAT). Most human medicines in KE are zero-rated.
  category: string;
  barcode: string;
  notes?: string;
  supplierId?: string;
  updatedAt: number;        // epoch ms — last-write-wins sync key
}

export interface CartLine {
  drugId: string;
  name: string;
  strength: string;
  qty: number;
  unitPrice: number;        // excl. tax
  taxRate: number;
  costPrice?: number;       // excl. tax, frozen at sale time — drives profit reporting
}

export type PaymentMethod = 'cash' | 'mpesa' | 'card' | 'mobile_money';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';

/** A discount applied to the whole sale, before tax is scaled proportionally. */
export interface Discount {
  type: 'percent' | 'amount';
  value: number;
}

export interface RefundRecord {
  id: string;
  at: number;
  lines: CartLine[];        // the quantities being refunded (subset of the original sale)
  amount: number;           // KES refunded, incl. tax
  reason?: string;
  staff?: string;
}

export interface Sale {
  id: string;
  invoiceNo: string;        // eTIMS-style sequential invoice number
  lines: CartLine[];
  subtotal: number;         // excl. tax, after discount
  taxTotal: number;         // after discount
  total: number;            // incl. tax, after discount
  discount?: Discount;
  discountAmount?: number;  // KES, incl. tax — resolved amount actually taken off
  method: PaymentMethod;
  status: PaymentStatus;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerPin?: string;     // buyer KRA PIN (optional, eTIMS)
  mpesaRef?: string;
  cashierId?: string;
  createdAt: number;
  synced: 0 | 1;
  etims?: EtimsStamp;
  refunds?: RefundRecord[];
}

/** KRA VAT tax category: A = Exempt (0% — most human medicines), B = Standard (16%). */
export interface EtimsTaxBreakdown {
  code: 'A' | 'B';
  label: string;
  taxableAmount: number;
  taxAmount: number;
}

/** Fields eTIMS (OSCU/VSCU) stamps onto a fiscalised invoice. Populated by the
 *  KRA control unit in production; placeholders in demo/simulation mode. */
export interface EtimsStamp {
  scuId: string;            // Sales Control Unit ID
  receiptSignature: string; // control-unit signature
  internalData: string;
  verifyUrl: string;        // QR target on itax
  taxBreakdown?: EtimsTaxBreakdown[];
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

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  kraPin?: string;
  notes?: string;
  loyaltyPoints: number;
  createdAt: number;
  updatedAt: number;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  outstandingBalance: number;
  rating?: number;          // 1-5
  createdAt: number;
  updatedAt: number;
}

export interface PurchaseOrderLine {
  drugId: string;
  name: string;
  qty: number;
  costPrice: number;        // excl. VAT
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  lines: PurchaseOrderLine[];
  total: number;
  status: 'pending' | 'received' | 'cancelled';
  createdAt: number;
  receivedAt?: number;
}

export interface SyncTask {
  id?: number;
  table: 'drugs' | 'sales' | 'orders' | 'audit' | 'customers' | 'suppliers' | 'purchaseOrders';
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
