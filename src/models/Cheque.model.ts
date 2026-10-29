import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { ExpenseLogCategory } from './ExpenseLog.model';

/**
 * A planned payment: a cheque given (often post-dated) or a UPI / bank / cash payment fixed for a date.
 * pending: not paid yet
 * cleared: paid (cheque encashed / money sent); written to the expense log, and to the vendor ledger
 *   or the bill it was for
 * bounced (cheques) / cancelled: never paid; kept for the record
 */
export const CHEQUE_STATUSES = ['pending', 'cleared', 'bounced', 'cancelled'] as const;
export type ChequeStatus = typeof CHEQUE_STATUSES[number];

export const PLANNED_METHODS = ['cheque', 'upi', 'bank_transfer', 'cash'] as const;
export type PlannedMethod = typeof PLANNED_METHODS[number];

export interface ICheque extends BaseDoc {
  /** missing on entries from before UPI / bank planning = cheque */
  method?: PlannedMethod;
  /** cheques only */
  chequeNo?: string;
  bank?: string;
  amount: number;
  /** date the payment is planned for (for a cheque, the date written on it) */
  chequeDate: Date;
  /** vendor payments pay down that vendor's dues when cleared */
  vendorId?: string;
  /** recurring / one-off bill (RecurringBill) this pays, and the part for split bills */
  billId?: string;
  billPart?: number;
  /** vendor or bill name, or who the payment is made to */
  payee: string;
  /** expense category when cleared: 'vendor' for vendors, the bill's category for bills */
  category: ExpenseLogCategory;
  note?: string;
  status: ChequeStatus;
  clearedOn?: Date;
  /** expense-log entry written when cleared */
  expenseLogId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Collection keeps its first name: planned payments started as cheques only. */
export const Cheque = createFirestoreModel<ICheque>('cheques', { mirror: true });
