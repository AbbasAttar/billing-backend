import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IPayment {
  date: Date;
  amount: number;
  method: 'cash' | 'online';
  writeoff?: number;
}

export type AcquisitionSource =
  | 'google_maps'
  | 'instagram'
  | 'whatsapp'
  | 'referral'
  | 'doctor_rx'
  | 'walk_by'
  | 'flyers'
  | 'repeat'
  | 'other';

export interface IInvoice extends BaseDoc {
  customer: string | any;
  items: string[] | any[];
  subtotal: number;
  discount: number;
  total: number;
  mrpTotal?: number;
  storePriceTotal?: number;
  realDiscount?: number;
  payments: IPayment[];
  billDate: Date;
  billClearDate?: Date;
  invoiceNumber?: string;
  acquisitionSource?: AcquisitionSource;
  totalCogs?: number;
  packagingCost?: number;
  paymentProcessingFee?: number;
  netContributionMargin?: number;
  contributionMarginPct?: number;
  isNewCustomer?: boolean;
  visitNumber?: number;
  /** Derived on every write (see computeInvoiceDueFields): sum of payments[].amount. */
  paidAmount?: number;
  /** Derived: max(0, total - paidAmount). Matches the admin UI's balance rule. */
  balance?: number;
  /** Derived: balance > 0.01. Lets "pending dues" be a native Firestore query. */
  hasDue?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Derives paidAmount / balance / hasDue from payments and total.
 * Returns null when the data needed is not present (e.g. a partial update that
 * touches neither payments nor total), so callers can skip the write.
 */
export function computeInvoiceDueFields(
  inv: { payments?: unknown; total?: unknown },
): { paidAmount: number; balance: number; hasDue: boolean } | null {
  if (!Array.isArray(inv.payments) || typeof inv.total !== 'number') return null;
  const paidAmount = inv.payments.reduce((sum: number, p: any) => sum + (Number(p?.amount) || 0), 0);
  const balance = Math.max(0, inv.total - paidAmount);
  return { paidAmount, balance, hasDue: balance > 0.01 };
}

export const Invoice = createFirestoreModel<IInvoice>('invoices', {
  mirror: true,
  beforeWrite: (payload) => {
    const derived = computeInvoiceDueFields(payload);
    if (derived) Object.assign(payload, derived);
  },
});
