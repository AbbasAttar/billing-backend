import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const CASHFLOW_TYPES = ['expense', 'payable'] as const;
export type CashflowType = typeof CASHFLOW_TYPES[number];

export const CASHFLOW_CATEGORIES = [
  'rent',
  'salary',
  'utilities',
  'stock',
  'maintenance',
  'transport',
  'marketing',
  'miscellaneous',
] as const;
export type CashflowCategory = typeof CASHFLOW_CATEGORIES[number];

export const CASHFLOW_PAYMENT_METHODS = [
  'cash',
  'upi',
  'card',
  'bank_transfer',
  'bank transfer',
  'cheque',
  'online',
  'other',
] as const;
export type CashflowPaymentMethod = (typeof CASHFLOW_PAYMENT_METHODS)[number];

export function normalizePaymentMethod(method?: string): CashflowPaymentMethod {
  if (!method) return 'cash';
  const m = method.trim().toLowerCase().replace(/\s+/g, '_');
  if (m === 'bank_transfer' || m === 'bank' || m === 'neft' || m === 'rtgs' || m === 'imps' || m === 'transfer') return 'bank_transfer';
  if (m === 'upi' || m === 'gpay' || m === 'phonepe' || m === 'paytm') return 'upi';
  if (m === 'card' || m === 'credit_card' || m === 'debit_card') return 'card';
  if (m === 'cheque' || m === 'check') return 'cheque';
  if (m === 'online' || m === 'netbanking') return 'bank_transfer';
  if (m === 'cash') return 'cash';
  return 'other';
}

export const CASHFLOW_STATUSES = ['logged', 'void', 'pending', 'partially_paid', 'paid', 'overdue'] as const;
export type CashflowStatus = typeof CASHFLOW_STATUSES[number];

export interface ICashflow extends BaseDoc {
  type: CashflowType;
  date: Date;
  dueDate?: Date;
  amount: number;
  paidAmount: number;
  status: CashflowStatus;
  category: string;
  vendorName?: string;
  note?: string;
  paymentMethod?: string;
  voidReason?: string;
  items: { description: string; amount: number }[];
  payments: { amount: number; date: Date; method: string; note?: string }[];
  obligationId?: string | any;
  obligationPaymentId?: string | any;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Cashflow = createFirestoreModel<ICashflow>('cashflows');
