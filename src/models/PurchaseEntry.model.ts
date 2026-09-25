import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { LENS_TYPES, LENS_MATERIALS, LENS_COLORS } from './LensPricing.model';

export type PurchaseStatus = 'pending' | 'received';

export interface IPurchaseEntry extends BaseDoc {
  status: PurchaseStatus;
  lensType: typeof LENS_TYPES[number] | null;
  material: typeof LENS_MATERIALS[number] | null;
  coating: string | null;
  color: typeof LENS_COLORS[number] | null;
  eye: 'right' | 'left' | 'both';
  sph: number | null;
  cyl: number;
  add: number | null;
  qty: number;
  costPerPair: number | null;
  supplier?: string | null;
  notes?: string | null;
  purchaseDate: Date;
  wholesalerOrderDate?: Date | null;
  importedFrom?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const PurchaseEntry = createFirestoreModel<IPurchaseEntry>('purchaseentries');
