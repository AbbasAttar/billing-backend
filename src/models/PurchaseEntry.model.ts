import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { LENS_TYPES, LENS_MATERIALS, LENS_COLORS } from './LensPricing.model';

export type PurchaseStatus = 'pending' | 'received';

export interface IPurchaseEntry extends BaseDoc {
  status: PurchaseStatus;
  lensType: typeof LENS_TYPES[number] | null;
  material: typeof LENS_MATERIALS[number] | null;
  coating: string | null;
  color: typeof LENS_COLORS[number] | null;
  brand?: string | null;
  eye: 'right' | 'left' | 'both';
  sph: number | null;
  cyl: number;
  add: number | null;
  qty: number;
  
  // Master Matrix Procurement fields (Standardized Per-Lens / Single Eye)
  unitCost: number | null;
  unitSellPrice?: number | null;
  costPerPair: number | null; // Kept for legacy compatibility (unitCost * 2)
  lensPricingId?: string | null;
  pricingSource?: 'matrix' | 'manual' | 'override' | null;

  // Invoice Batch Tracking
  supplier?: string | null;
  supplierInvoiceRef?: string | null;
  purchaseInvoiceId?: string | null;
  notes?: string | null;
  purchaseDate: Date;
  wholesalerOrderDate?: Date | null;
  importedFrom?: string | null;

  // Legacy preservation & normalization
  rawDescription?: string | null;
  normalizedLens?: {
    type?: string | null;
    material?: string | null;
    coating?: string | null;
    brand?: string | null;
  } | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PurchaseEntry = createFirestoreModel<IPurchaseEntry>('purchaseentries');

