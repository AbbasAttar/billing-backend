import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { searchTokenHook } from '../lib/searchTokens';
import { IWebFields } from './webFields.schema';

export interface IFrame extends BaseDoc {
  companyName: string;
  name: string;
  houseName?: string;
  type?: string;
  costPrice?: number;
  sellPrice?: number;
  mrp?: number;
  storePrice?: number;
  tier?: 'essential' | 'trendy' | 'premium' | 'luxury';
  floorPrice?: number;
  secretCode?: string;
  stock?: number;
  frameCode?: string;
  isArchived?: boolean;
  archivedAt?: Date;
  web?: IWebFields;
  createdAt?: Date;
  updatedAt?: Date;
}

const frameTokens = searchTokenHook(['name', 'companyName', 'houseName', 'frameCode'], (f) => ({
  text: [f.name, f.companyName, f.houseName],
  codes: [f.frameCode],
}));

export const Frame = createFirestoreModel<IFrame>('frames', {
  mirror: true,
  hiddenFields: ['searchTokens'],
  beforeWrite: async (payload, ctx) => {
    // Always store the flag: a missing isArchived is invisible to Firestore `==` / `!=` queries.
    if (ctx.full && payload.isArchived === undefined) payload.isArchived = false;
    await frameTokens(payload, ctx);
  },
});
