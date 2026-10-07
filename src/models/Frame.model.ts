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

export const Frame = createFirestoreModel<IFrame>('frames', {
  hiddenFields: ['searchTokens'],
  beforeWrite: searchTokenHook(['name', 'companyName', 'houseName', 'frameCode'], (f) => ({
    text: [f.name, f.companyName, f.houseName],
    codes: [f.frameCode],
  })),
});
