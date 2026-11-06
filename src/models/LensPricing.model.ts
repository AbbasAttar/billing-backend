import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const LENS_TYPES     = ['Single Vision', 'Bifocal', 'Progressive'] as const;
/** Starting lists only: the shop edits materials and colours on Settings → Lens Config (LensOption). */
export const LENS_MATERIALS = ['Polycarbonate', 'Fiber', 'Glass'] as const;
export const LENS_COLORS    = ['White', 'Photo Chromatic', 'Polarized', 'Tinted'] as const;
/** The clear (no tint) colour; pricing treats it as "no tint", so it cannot be removed. */
export const CLEAR_COLOR    = 'White';
export const AXIS_TYPES     = ['any', 'ready', 'cross'] as const;

export type LensType     = typeof LENS_TYPES[number];
export type LensMaterial = string;
export type LensColor    = string;
export type AxisType     = typeof AXIS_TYPES[number];

/** Material, colour and coating names are free text picked from the shop's lists. */
export const isLensName = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 40;

export interface ILensPricing extends BaseDoc {
  lensType:  LensType;
  material:  LensMaterial;
  coating:   string;
  color:     LensColor;
  axisType:  AxisType;   // 'ready' | 'cross' | 'any'
  minSph:    number;
  maxSph:    number;
  minCyl:    number;
  maxCyl:    number;
  minAdd:    number | null;
  maxAdd:    number | null;
  price:     number;
  costPrice: number;
  wholesaler?: string;
  /** Lens company (LensCompany.name). Missing = older rule: wholesaler, else Local. */
  company?:    string;
  /** Product line, e.g. 'Egalite 56 ASP'. */
  brand?:      string;
  features?:   string[];
  mrp?:        number;
  effectiveDate?: string;
  dia?:        string;
  /** 'pair' once the price is confirmed per pair (see scripts/migrateLensPricingPerPair). */
  priceUnit?:  'pair';
  createdAt?: Date;
  updatedAt?: Date;
}

export const LensPricing = createFirestoreModel<ILensPricing>('lenspricings', { mirror: true });
