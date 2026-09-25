import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { LENS_TYPES, LENS_MATERIALS, LENS_COLORS } from './LensPricing.model';

export interface ILensStock extends BaseDoc {
  lensType: typeof LENS_TYPES[number];
  material: typeof LENS_MATERIALS[number];
  coating: string;
  color: typeof LENS_COLORS[number];
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

export const LensStock = createFirestoreModel<ILensStock>('lensstocks');
