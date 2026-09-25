import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IObligationPayment extends BaseDoc {
  obligationId: string | any;
  creditor: string;
  amountPaid: number;
  date: Date;
  method?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ObligationPayment = createFirestoreModel<IObligationPayment>('obligationpayments');
