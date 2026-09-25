import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const OBLIGATION_CATEGORIES = ['vendor', 'personal', 'loan', 'other'] as const;
export type ObligationCategory = (typeof OBLIGATION_CATEGORIES)[number];

export const OBLIGATION_PRIORITIES = ['1-critical', '2-high', '3-normal', '4-low'] as const;
export type ObligationPriority = (typeof OBLIGATION_PRIORITIES)[number];

export const OBLIGATION_STATUSES = ['open', 'paid'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export interface IObligationItem {
  description: string;
  amount: number;
}

export interface IObligation extends BaseDoc {
  creditor: string;
  category: ObligationCategory;
  subcategory?: string;
  originalAmount: number;
  alreadyPaid: number;
  priority: ObligationPriority;
  dueDate?: Date;
  billDate?: Date;
  minPayment: number;
  isRecurring: boolean;
  dueDay?: number;
  notes?: string;
  status: ObligationStatus;
  items: IObligationItem[];
  migratedFrom?: 'VendorBill' | 'Debt';
  createdAt?: Date;
  updatedAt?: Date;
}

export const Obligation = createFirestoreModel<IObligation>('obligations');
