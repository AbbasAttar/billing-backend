import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { ExpenseLogCategory, ExpenseLogMethod } from './ExpenseLog.model';

/** One way a split bill is paid, e.g. "Rent cash" ₹12,500 by cash. */
export interface RecurringPart {
  label: string;
  method: ExpenseLogMethod;
  amount: number;
  /** unpaid in the current cycle */
  due: number;
}

/**
 * installment: finishes after totalInstallments are paid (loan, EMI, qardan).
 * ongoing: never finishes (rent, salary, wifi).
 * one_time: a single unpaid amount (doctor, repair, a friend); finishes once paid, never resets.
 */
export const RECURRING_KINDS = ['installment', 'ongoing', 'one_time'] as const;
export type RecurringKind = typeof RECURRING_KINDS[number];

export const BILL_SCOPES = ['business', 'personal'] as const;
export type BillScope = typeof BILL_SCOPES[number];

export interface IRecurringBill extends BaseDoc {
  name: string;
  kind: RecurringKind;
  category: ExpenseLogCategory;
  /** amount of one installment / one month */
  amount: number;
  totalInstallments?: number;
  paidInstallments: number;
  /** what is still unpaid in the current cycle; 0 once paid, until reset */
  dueRemaining: number;
  /** increments on every reset; payments remember the cycle they belong to */
  cycle: number;
  dueDay?: number;
  /** one_time only: when it should be paid by */
  dueDate?: Date;
  /** whose money it is; payments carry it into the expense log */
  scope?: BillScope;
  status: 'active' | 'completed';
  /** set when the bill is paid in parts by different methods; amount = sum of part amounts */
  parts?: RecurringPart[];
  note?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const RecurringBill = createFirestoreModel<IRecurringBill>('recurringbills', { mirror: true });
