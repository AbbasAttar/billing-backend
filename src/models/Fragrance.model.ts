import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
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

export const Fragrance = createFirestoreModel<IFragrance>('fragrances');
