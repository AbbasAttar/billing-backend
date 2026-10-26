import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const EXPENSE_LOG_CATEGORIES = ['home', 'staff_snacks', 'fitting', 'vendor', 'utility', 'running'] as const;
export const EXPENSE_LOG_METHODS = ['cash', 'upi', 'card', 'bank_transfer'] as const;

export type ExpenseLogCategory = typeof EXPENSE_LOG_CATEGORIES[number];
export type ExpenseLogMethod = typeof EXPENSE_LOG_METHODS[number];

/**
 * Where an entry came from. Manual entries have none; payments made from a recurring bill or a
 * vendor account point back so deleting the entry can undo its effect there.
 */
export interface ExpenseLogSource {
  kind: 'recurring' | 'vendor';
  id: string;
  name: string;
  /** recurring only: the bill cycle the payment went to, and whether it finished that installment */
  cycle?: number;
  completedInstallment?: boolean;
  /** recurring only: index of the bill part paid (split bills) */
  part?: number;
  /** vendor only: the matching VendorTxn */
  txnId?: string;
}

export interface IExpenseLog extends BaseDoc {
  date: Date;
  category: ExpenseLogCategory;
  amount: number;
  note?: string;
  paymentMethod: ExpenseLogMethod;
  source?: ExpenseLogSource;
  /** personal / business, copied from the bill a payment was made against */
  scope?: 'business' | 'personal';
  /** _id of the old `expenses` document this entry was copied from (importOldExpenses script) */
  importedFrom?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ExpenseLog = createFirestoreModel<IExpenseLog>('expenselogs', { mirror: true });
