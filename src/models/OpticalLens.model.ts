import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { searchTokenHook } from '../lib/searchTokens';
import { IWebFields } from './webFields.schema';

export interface IOpticalLens extends BaseDoc {
  brand: string;
  name: string;
  category: 'Single Vision' | 'Bifocal' | 'Progressive';
  index?: string;
  coating?: string | null;
  spherical?: number;
  cylinder?: number;
  addition?: number;
  costPrice?: number;
  sellPrice?: number;
  web?: IWebFields;
  createdAt?: Date;
  updatedAt?: Date;
}

export const OpticalLens = createFirestoreModel<IOpticalLens>('opticallens', {
  hiddenFields: ['searchTokens'],
  beforeWrite: searchTokenHook(['name', 'brand', 'category'], (l) => ({
    text: [l.name, l.brand, l.category],
  })),
});
