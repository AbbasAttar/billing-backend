import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const DEBT_PRIORITIES = ['1-critical', '2-high', '3-normal', '4-low'] as const;
export type DebtPriority = (typeof DEBT_PRIORITIES)[number];

export const DEBT_STATUSES = ['open', 'paid'] as const;
export type DebtStatus = (typeof DEBT_STATUSES)[number];

export const DEBT_PAYMENT_TYPES = ['recurring-minimum', 'deadline-full'] as const;
export type DebtPaymentType = (typeof DEBT_PAYMENT_TYPES)[number];

export interface IDebt extends BaseDoc {
  debtId: string;
  creditor: string;
  originalAmount: number;
  alreadyPaid: number;
  priority: DebtPriority;
  dueDate?: Date;
  minimumPayment: number;
  notes?: string;
  status: DebtStatus;
  paymentType: DebtPaymentType;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Debt = createFirestoreModel<IDebt>('debts');
