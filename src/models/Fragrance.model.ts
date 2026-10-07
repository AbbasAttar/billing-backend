import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { searchTokenHook } from '../lib/searchTokens';
import { IWebFields } from './webFields.schema';

export interface IFragranceVariant {
  label: string;
  costPrice?: number;
  sellPrice: number;
  stock: number;
}

export interface IFragrance extends BaseDoc {
  type: 'perfume' | 'attar' | 'bakhoor';
  companyName: string;
  name: string;
  authenticity?: 'original' | 'dupe';
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  variants: IFragranceVariant[];
  isArchived?: boolean;
  archivedAt?: Date;
  web?: IWebFields;
  createdAt?: Date;
  updatedAt?: Date;
}

const fragranceTokens = searchTokenHook(['name', 'companyName'], (f) => ({
  text: [f.name, f.companyName],
}));

export const Fragrance = createFirestoreModel<IFragrance>('fragrances', {
  mirror: true,
  hiddenFields: ['searchTokens'],
  beforeWrite: async (payload, ctx) => {
    // Always store the flag: a missing isArchived is invisible to Firestore `==` / `!=` queries.
    if (ctx.full && payload.isArchived === undefined) payload.isArchived = false;
    await fragranceTokens(payload, ctx);
  },
});
