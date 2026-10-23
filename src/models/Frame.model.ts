import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { searchTokenHook } from '../lib/searchTokens';
import { IWebFields } from './webFields.schema';
import type { FrameCategory, ReadingType } from '../services/frameAttributes';

export interface IFrame extends BaseDoc {
  companyName: string;
  name: string;
  houseName?: string;
  /** Rim type: Full Rim / Half Rim / Rimless. */
  type?: string;
  /** optical / sunglass / reading / kids (see services/frameAttributes.ts). */
  category?: FrameCategory;
  /** Reading glasses: Single Vision / Bifocal / Progressive (variants may set their own). */
  readingType?: ReadingType;
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
  /** Delivery date the frame came in; older frames fall back to createdAt for stock age. */
  inwardDate?: Date | string;
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
