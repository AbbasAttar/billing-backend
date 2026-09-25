import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const EXPENSE_CATEGORIES = [
  'staff_tea',
  'maintenance',
  'delivery',
  'miscellaneous',
  'rent',
  'salary',
  'utilities',
  'stock',
  'transport',
  'marketing',
  'vendor_order',
  'home_expense',
] as const;

export const EXPENSE_PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer'] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export type ExpensePaymentMethod = typeof EXPENSE_PAYMENT_METHODS[number];

export interface IExpense extends BaseDoc {
  date: Date;
  amount: number;
  category: ExpenseCategory;
  note?: string;
  vendorName?: string;
  paymentMethod: ExpensePaymentMethod;
  isVoid: boolean;
  voidReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Expense = createFirestoreModel<IExpense>('expenses');
