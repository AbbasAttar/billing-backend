import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IPayment {
  date: Date;
  amount: number;
  method: 'cash' | 'online';
  writeoff?: number;
}

export type AcquisitionSource =
  | 'google_maps'
  | 'instagram'
  | 'whatsapp'
  | 'referral'
  | 'doctor_rx'
  | 'walk_by'
  | 'flyers'
  | 'repeat'
  | 'other';

export interface IInvoice extends BaseDoc {
  customer: string | any;
  items: string[] | any[];
  subtotal: number;
  discount: number;
  total: number;
  mrpTotal?: number;
  storePriceTotal?: number;
  realDiscount?: number;
  payments: IPayment[];
  billDate: Date;
  billClearDate?: Date;
  invoiceNumber?: string;
  acquisitionSource?: AcquisitionSource;
  totalCogs?: number;
  packagingCost?: number;
  paymentProcessingFee?: number;
  netContributionMargin?: number;
  contributionMarginPct?: number;
  isNewCustomer?: boolean;
  visitNumber?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Invoice = createFirestoreModel<IInvoice>('invoices');
