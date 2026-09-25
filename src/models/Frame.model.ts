import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
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

export const Frame = createFirestoreModel<IFrame>('frames');
