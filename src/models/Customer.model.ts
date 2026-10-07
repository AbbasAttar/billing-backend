import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { searchTokenHook } from '../lib/searchTokens';

export interface ICustomer extends BaseDoc {
  name: string;
  address?: string;
  mobileNumber: string;
  email?: string;
  dateOfBirth?: Date;
  tags: string[];
  notes?: string;
  preferredChannel?: 'whatsapp' | 'sms' | 'email';
  lastContactedAt?: Date;
  lastContactType?: string;
  snoozedUntil?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Customer = createFirestoreModel<ICustomer>('customers', {
  hiddenFields: ['searchTokens'],
  beforeWrite: searchTokenHook(['name', 'mobileNumber'], (c) => ({
    text: [c.name],
    numbers: [c.mobileNumber],
  })),
});
