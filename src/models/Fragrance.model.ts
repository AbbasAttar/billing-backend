import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { searchTokenHook } from '../lib/searchTokens';
import { IWebFields } from './webFields.schema';

/**
 * One sellable option of a fragrance: a grade (attar quality) or a size. Retail price is what the
 * counter and website use; cost and wholesale price are never shown on the website.
 */
export interface IFragranceVariant {
  label: string;
  axis?: 'grade' | 'size';
  /**
   * Series products (one range in several types and sizes, e.g. Naseem Classic): the type (scent
   * name) and size of this option. The label stays the key ("Oud 30ml").
   */
  typeName?: string;
  size?: string;
  /** Size in ml, for sizes (fills prices from a price per ml). */
  sizeMl?: number;
  costPrice?: number;
  /** Retail price (per tola for attar grades, per bottle / pack otherwise). */
  sellPrice: number;
  stock: number;
  /** Shown on the website (default true). */
  online?: boolean;
  /** Wholesale price for this option; no price = not sold wholesale. */
  wholesale?: { price: number; unit: string; minQty?: number };
  /** What one unit of this option is made from (bulk oil, bottle…). */
  recipe?: { fragranceId: string; optionLabel?: string; qty: number }[];
  /** Wholesale re-order state for this option (see IWholesaleState). */
  ws?: IWholesaleState;
}

/** Wholesale stock keeping: alert level and the order to the maker / supplier. */
export interface IWholesaleState {
  reorderLevel?: number | null;
  inOrderQueue?: boolean;
  queueQty?: number | null;
  isOrdered?: boolean;
  orderedQty?: number | null;
  orderedAt?: Date | null;
}

export interface IScentProfile {
  top?: string[];
  heart?: string[];
  base?: string[];
  projection?: 'soft' | 'moderate' | 'strong';
  seasons?: string[];
  occasions?: string[];
  /** One sentence staff can say at the counter (internal). */
  sellingLine?: string;
  /** For dupes: the original it resembles (internal, never on the website). */
  similarTo?: string;
}

/** Series products: the scent of one type (same in every size), with its own family and longevity. */
export interface ITypeScent extends IScentProfile {
  typeName: string;
  family?: string[];
  longevity?: string;
}

export interface IFragrance extends BaseDoc {
  type: 'perfume' | 'attar' | 'bakhoor' | 'body spray' | 'essence' | 'packaging';
  gender?: 'men' | 'women' | 'unisex';
  /** Where it is sold / used. Missing = retail only. */
  channels?: { retail?: boolean; wholesale?: boolean; rawMaterial?: boolean };
  scent?: IScentProfile;
  /** Series products: scent profile per type (the product's own `scent` covers the whole series). */
  typeScents?: ITypeScent[] | null;
  /** Plain products (no grades / sizes): wholesale price, recipe and wholesale order state. */
  wholesale?: IFragranceVariant['wholesale'] | null;
  recipe?: IFragranceVariant['recipe'] | null;
  ws?: IWholesaleState;
  /** Selling this also takes its "made from" ingredients out of stock. */
  recipeDeductsStock?: boolean;
  /** Stock unit when it differs from the type's usual one (e.g. bulk attar counted in bottles). */
  unit?: string;
  notes?: string;
  /** Wholesale company (maker / supplier) this is bought from. */
  companyId?: string | null;
  /** The wholesale item this record was moved from (old bills still point there). */
  legacyWholesaleId?: string;
  companyName: string;
  name: string;
  authenticity?: 'original' | 'dupe';
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  variants: IFragranceVariant[];
  isArchived?: boolean;
  archivedAt?: Date;
  /** Same-name products marked as really different, so the duplicate check skips the pair. */
  notDuplicateOf?: string[];
  web?: IWebFields;
  createdAt?: Date;
  updatedAt?: Date;
}

// Series type names ("White Musk") are searchable too, so billing finds the product by its type.
const fragranceTokens = searchTokenHook(['name', 'companyName', 'variants'], (f) => ({
  text: [f.name, f.companyName, ...((f.variants ?? []) as IFragranceVariant[]).map((v) => v.typeName).filter(Boolean)],
}));

export const Fragrance = createFirestoreModel<IFragrance>('fragrances', {
  mirror: true,
  hiddenFields: ['searchTokens'],
  beforeWrite: async (payload, ctx) => {
    // Always store the flag: a missing isArchived is invisible to Firestore `==` / `!=` queries.
    if (ctx.full && payload.isArchived === undefined) payload.isArchived = false;
    await fragranceTokens(payload, ctx);
  },
});
