import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { LENS_TYPES } from './LensPricing.model';

export interface ILensStock extends BaseDoc {
  lensType: typeof LENS_TYPES[number];
  material: string;
  coating: string;
  color: string;
  sph: number;
  cyl: number;
  add: number | null;
  quantity: number;
  reorderLevel: number;
  costPrice: number;
  lastCost?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const LensStock = createFirestoreModel<ILensStock>('lensstocks', { mirror: true });
