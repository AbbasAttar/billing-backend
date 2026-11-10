import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { LENS_TYPES } from './LensPricing.model';

export interface ILensStock extends BaseDoc {
  lensType: typeof LENS_TYPES[number];
  material: string;
  coating: string;
  color: string;
  sph: number;
  cyl: number;
  /** Axis (0–180) of the CYL; null when there is no CYL or it wasn't recorded. */
  axis?: number | null;
  add: number | null;
  quantity: number;
  /**
   * Progressive blanks are made for one eye. With an odd count (a half pair on the shelf) this says
   * which eye the spare lens is for. Ignored when the count is even.
   */
  oddEye?: 'right' | 'left' | null;
  reorderLevel: number;
  costPrice: number;
  lastCost?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const LensStock = createFirestoreModel<ILensStock>('lensstocks', { mirror: true });
