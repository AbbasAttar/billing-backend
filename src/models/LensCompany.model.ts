import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const LENS_TIERS = ['essential', 'premium', 'luxury'] as const;

/** wholesaler = bought through a lens wholesaler (an expense vendor) · direct = bought from the company itself. */
export const SUPPLY_TYPES = ['wholesaler', 'direct'] as const;

export type LensTier = typeof LENS_TIERS[number];
export type SupplyType = typeof SUPPLY_TYPES[number];

/** The company that makes a lens (Local, Kodak, Essilor…). Product lines stay on LensPricing.brand. */
export interface ILensCompany extends BaseDoc {
  name: string;
  supplyType?: SupplyType;
  /** Wholesaler's vendor name (expense vendors, category lens); null when bought direct. */
  supplier?: string | null;
  tier: LensTier;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Lenses with no company are the shop's own local lenses. */
export const LOCAL_COMPANY = 'Local';

export const LensCompany = createFirestoreModel<ILensCompany>('lenscompanies', { mirror: true });
