import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const RECURRING_CATEGORIES = [
  'rent', 'electricity', 'salary', 'internet', 'stationery', 'packaging',
  'marketing', 'repairs', 'transportation', 'bank_charges', 'qurdan', 'loan',
  'taxes', 'insurance', 'professional', 'miscellaneous',
] as const;
export type RecurringCategory = (typeof RECURRING_CATEGORIES)[number];

export interface IRecurringDeposit {
  _id?: string;
  amount: number;
  date: Date;
  method?: string;
  note?: string;
}

export interface IRecurringExpense extends BaseDoc {
  name: string;
  category: string;
  amount: number;
  frequency: RecurringFrequency;
  dayOfMonth?: number;
  nextDueDate: Date;
  reminderDays: number;
  autoGenerate: boolean;
  autoMarkPaid: boolean;
  paymentMethod?: string;
  vendorName?: string;
  notes?: string;
  isActive: boolean;
  completionDate?: Date;
  totalRepaymentAmount?: number;
  totalRepaidAmount?: number;
  isLoanOrDebt?: boolean;
  repaymentStatus?: 'ongoing' | 'completed' | 'paused';
  deposits: IRecurringDeposit[];
  prepaidAmount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const RecurringExpense = createFirestoreModel<IRecurringExpense>('recurringexpenses');
