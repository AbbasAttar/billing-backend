import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const BILL_STATUSES = ['pending', 'partially_paid', 'paid', 'overdue'] as const;
export type BillStatus = typeof BILL_STATUSES[number];

export interface IVendorBill extends BaseDoc {
  vendorName: string;
  billDate: Date;
  dueDate?: Date;
  totalAmount: number;
  paidAmount: number;
  status: BillStatus;
  category: string;
  note?: string;
  items: {
    description: string;
    amount: number;
  }[];
  payments: {
    amount: number;
    date: Date;
    method: string;
    note?: string;
  }[];
  createdAt?: Date;
  updatedAt?: Date;
}

export const VendorBill = createFirestoreModel<IVendorBill>('vendorbills');
