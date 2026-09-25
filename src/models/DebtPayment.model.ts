import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IDebtPayment extends BaseDoc {
  date: Date;
  debtId: string;
  creditor: string;
  amountPaid: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DebtPayment = createFirestoreModel<IDebtPayment>('debtpayments');
