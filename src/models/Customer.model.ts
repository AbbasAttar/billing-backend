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
  /** Recalls: how the shop should reach this customer (missing / 'auto' = each recall's own channel). */
  contactPreference?: 'auto' | 'call' | 'whatsapp' | 'no_contact';
  /** Recalls: outcome of the last contact, unanswered calls in a row and when to try again. */
  lastContactOutcome?: string;
  noAnswerCount?: number;
  nextAttemptAt?: Date | null;
  /** Recalls: the number was reported wrong; no recalls until it is corrected. */
  phoneInvalid?: boolean;
  /** Recalls: when each recall type was last handled, so it is not repeated for the same purchase. */
  recallContacts?: Record<string, Date>;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Customer = createFirestoreModel<ICustomer>('customers', {
  mirror: true,
  hiddenFields: ['searchTokens'],
  beforeWrite: searchTokenHook(['name', 'mobileNumber'], (c) => ({
    text: [c.name],
    numbers: [c.mobileNumber],
  })),
});
