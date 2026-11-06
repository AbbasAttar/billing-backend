import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

/**
 * Lens catalogue v3 (docs/lens-price-book-v2-plan.md): each company's own coatings, products and add-ons,
 * tagged with a shared vocabulary so the same lens from different companies can be compared.
 */

/** One feature list for coatings, products (built in) and add-ons. */
export const LENS_FEATURES = [
  'hardCoat',
  'antiReflection',
  'waterRepel',
  'uv',
  'blueFilter',
  'nightDrive',
  'antiFog',
  'photochromic',
  'polarized',
  'mirror',
  'personalised',
  'myopiaControl',
] as const;
export type LensFeature = typeof LENS_FEATURES[number];

/** Features a coating can carry; the coating class is worked out from them. */
export const COATING_FEATURES: LensFeature[] = ['hardCoat', 'antiReflection', 'waterRepel', 'uv', 'blueFilter', 'nightDrive', 'antiFog'];

export const CATALOG_LENS_TYPES = ['Single Vision', 'Bifocal', 'Progressive', 'Office'] as const;
export type CatalogLensType = typeof CATALOG_LENS_TYPES[number];

export const PRODUCT_TIERS = ['Entry', 'Mid', 'Premium', 'Top'] as const;
export type ProductTier = typeof PRODUCT_TIERS[number];

/** A company's own coating, e.g. Essilor "Crizal Rock". */
export interface IBrandCoating extends BaseDoc {
  company: string;
  name: string;
  shortName?: string | null;
  features: LensFeature[];
  note?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PricePair {
  /** Customer price per pair (SRP). */
  srp: number;
  /** What the shop pays per pair (wholesale price). */
  cost: number;
}

/** One index a product comes in, with its power range and a price per coating (keyed by brand coating id). */
export interface ProductRow {
  index: number;
  minSph: number;
  maxSph: number;
  /** Largest cylinder covered, by size. */
  maxCyl: number;
  minAdd?: number | null;
  maxAdd?: number | null;
  dia?: string | null;
  engraving?: string | null;
  prices: Record<string, PricePair>;
}

/** A company's product as the supplier knows it, e.g. Prime "Proton Blublock". */
export interface ILensProduct extends BaseDoc {
  company: string;
  name: string;
  range?: string | null;
  lensType: CatalogLensType;
  tier: ProductTier;
  /** Optional shared design tag (Wide Corridor, Digital…). */
  design?: string | null;
  /** Built in, e.g. blueFilter for Blublock, photochromic for Daynite. */
  features: LensFeature[];
  /** Base product this one is a variant of (same lens plus a built-in feature). */
  variantOf?: string | null;
  note?: string | null;
  rows: ProductRow[];
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/** A company's priced extra, e.g. Essilor Fog-free +₹2000. Percent add-ons scale the lens price and cost. */
export interface ILensAddon extends BaseDoc {
  company: string;
  name: string;
  kind: 'fixed' | 'percent';
  /** fixed: rupees per pair · percent: e.g. -5 for 5% less. */
  srp: number;
  /** fixed: rupees per pair the shop pays · percent: ignored (cost scales by the same percent). */
  cost: number;
  /** Feature it adds, if any (Blue UV Capture → blueFilter). */
  feature?: LensFeature | null;
  /** Only these products (ids); empty = every product of the company. */
  productIds: string[];
  /** Only with these coatings (ids); empty = any. */
  coatingIds: string[];
  /** Never with these coatings (ids). */
  excludeCoatingIds: string[];
  note?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const BrandCoating = createFirestoreModel<IBrandCoating>('brandcoatings', { mirror: true });
export const LensProduct = createFirestoreModel<ILensProduct>('lensproducts', { mirror: true });
export const LensAddon = createFirestoreModel<ILensAddon>('lensaddons', { mirror: true });
