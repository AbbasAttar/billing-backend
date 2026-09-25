import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const PERSONAL_EXPENSE_CATEGORIES = [
  'ration',
  'utilities',
  'medicine',
  'emi',
  'school',
  'fuel',
  'travel',
  'entertainment',
  'insurance',
  'maintenance',
  'miscellaneous',
] as const;

export const PERSONAL_PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer'] as const;

export type PersonalExpenseCategory = typeof PERSONAL_EXPENSE_CATEGORIES[number];
export type PersonalPaymentMethod = typeof PERSONAL_PAYMENT_METHODS[number];

export interface IPersonalExpense extends BaseDoc {
  date: Date;
  amount: number;
  category: PersonalExpenseCategory;
  note?: string;
  paymentMethod: PersonalPaymentMethod;
  isRecurring: boolean;
  recurringDay?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const PersonalExpense = createFirestoreModel<IPersonalExpense>('personalexpenses');
