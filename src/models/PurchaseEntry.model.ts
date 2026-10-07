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

  /** Derived on every write (see computePurchaseFlags): shows in the procurement ledger. */
  isLedger?: boolean;
  /** Derived: still pending, or missing a valid cost. */
  isPending?: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Ledger / pending flags so both pages are native Firestore queries instead of a full scan
 * with an OR over cost fields. Mirrors the rules the history endpoint used to apply.
 */
export function computePurchaseFlags(e: {
  status?: unknown;
  costPerPair?: unknown;
  unitCost?: unknown;
}): { isLedger: boolean; isPending: boolean } {
  const hasPairCost = Number(e.costPerPair) > 0;
  const hasUnitCost = Number(e.unitCost) > 0;
  return {
    isLedger: e.status === 'received' && (hasPairCost || hasUnitCost),
    isPending: e.status === 'pending' || !hasPairCost || !hasUnitCost,
  };
}

const COST_FIELDS = ['status', 'costPerPair', 'unitCost'];

export const PurchaseEntry = createFirestoreModel<IPurchaseEntry>('purchaseentries', {
  beforeWrite: async (payload, ctx) => {
    if (ctx.full) {
      Object.assign(payload, computePurchaseFlags(payload));
      return;
    }
    if (!COST_FIELDS.some((f) => f in payload)) return;
    // The flags depend on all three fields, so merge the update with the stored entry.
    const merged = { ...((await ctx.getExisting()) ?? {}), ...payload };
    Object.assign(payload, computePurchaseFlags(merged));
  },
});

