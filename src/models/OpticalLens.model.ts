import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
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

export const OpticalLens = createFirestoreModel<IOpticalLens>('opticallens');
