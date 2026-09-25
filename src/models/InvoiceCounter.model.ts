import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IInvoiceCounter extends BaseDoc {
  year: string; // e.g. "26-27"
  lastSeq: number;
}

export const InvoiceCounter = createFirestoreModel<IInvoiceCounter>('invoicecounters');
