import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export type RequirementCategory = 'frame' | 'opticalLens' | 'contactLens' | 'fragrance' | 'accessory' | 'other';
export type RequirementStatus = 'pending' | 'ordered' | 'arrived' | 'fulfilled' | 'cancelled';
export type RequirementUrgency = 'urgent' | 'normal' | 'low';

export interface ICustomerRequirement extends BaseDoc {
  date: Date;
  customer?: string | any;
  customerName: string;
  customerMobile: string;
  customerCity?: string;
  category: RequirementCategory;
  title: string;
  brand?: string;
  modelNumber?: string;
  color?: string;
  specifications?: string;
  estimatedPrice?: number;
  urgency: RequirementUrgency;
  status: RequirementStatus;
  notes?: string;
  vendorNotes?: string;
  arrivedDate?: Date;
  fulfilledDate?: Date;
  convertedInvoiceId?: string | any;
  createdAt?: Date;
  updatedAt?: Date;
}

export const CustomerRequirement = createFirestoreModel<ICustomerRequirement>('customerrequirements');
