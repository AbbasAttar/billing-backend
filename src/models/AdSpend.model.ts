import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export type AdSpendChannel =
  | 'whatsapp'
  | 'facebook'
  | 'instagram'
  | 'google'
  | 'sms'
  | 'newspaper'
  | 'flyers'
  | 'events'
  | 'other';

export interface IAdSpend extends BaseDoc {
  date: Date;
  channel: AdSpendChannel;
  campaignName?: string;
  amount: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const AdSpend = createFirestoreModel<IAdSpend>('adspends');
