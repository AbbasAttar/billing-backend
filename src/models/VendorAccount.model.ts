import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { ExpenseLogMethod } from './ExpenseLog.model';

/** What a vendor supplies; used for per-category purchase caps and the payment plan. */
export const VENDOR_CATEGORIES = ['fragrance', 'lens', 'frame', 'other'] as const;
export type VendorCategory = typeof VENDOR_CATEGORIES[number];

export interface IVendorAccount extends BaseDoc {
  name: string;
  category?: VendorCategory;
  phone?: string;
  note?: string;
  /** amount still owed to the vendor; negative means an advance with them */
  balance: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * add: bill / extra amount owed (+balance)
 * pay: payment to vendor (-balance, also written to the expense log)
 * less: discount / return / correction (-balance, no expense)
 */
export const VENDOR_TXN_TYPES = ['add', 'pay', 'less'] as const;
export type VendorTxnType = typeof VENDOR_TXN_TYPES[number];

export interface IVendorTxn extends BaseDoc {
  vendorId: string;
  vendorName: string;
  date: Date;
  type: VendorTxnType;
  amount: number;
  note?: string;
  paymentMethod?: ExpenseLogMethod;
  expenseLogId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const VendorAccount = createFirestoreModel<IVendorAccount>('vendoraccounts', { mirror: true });
export const VendorTxn = createFirestoreModel<IVendorTxn>('vendortxns', { mirror: true });
