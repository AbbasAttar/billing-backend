import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { searchTokenHook } from '../lib/searchTokens';
import { IWebFields } from './webFields.schema';

export interface IContactLens extends BaseDoc {
  brand: string;
  name: string;
  lensType: 'daily' | 'monthly' | 'biweekly';
  packSize?: number;
  baseCurve?: string;
  diameter?: string;
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  web?: IWebFields;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ContactLens = createFirestoreModel<IContactLens>('contactlens', {
  mirror: true,
  hiddenFields: ['searchTokens'],
  beforeWrite: searchTokenHook(['name', 'brand'], (l) => ({
    text: [l.name, l.brand],
  })),
});
