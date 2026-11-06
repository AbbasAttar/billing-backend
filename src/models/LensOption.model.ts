import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import type { BrandAlias } from '../services/lensAliases';

/**
 * Lists on Settings → Lens Config (coatings live in Coating). See docs/lens-price-book-v2-plan.md, "Lens model v2".
 *   material    — Glass, Fiber, Polycarbonate
 *   index       — per material (parent), e.g. Fiber 1.56; value = the number
 *   design      — per lens type (parent), shared by every company; described by what it is, best-for tags and level
 *   photoColor  — photochromic colours (Grey, Brown…)
 *   tintColor   — fixed tint colours, shared by every company
 *   tintStep    — solid density % or gradient top %→0 (style + value)
 *   mirrorColor — mirror finish colours
 *   color       — the old flat colour list (White / Photo Chromatic / Polarized / Tinted), used by bills
 *                 and pricing rules until they move to the tint fields above
 */
export const LENS_OPTION_KINDS = [
  'material',
  'index',
  'design',
  'photoColor',
  'tintColor',
  'tintStep',
  'mirrorColor',
  'color',
] as const;
export type LensOptionKind = typeof LENS_OPTION_KINDS[number];

export const TINT_STYLES = ['solid', 'gradient'] as const;
export type TintStyle = typeof TINT_STYLES[number];

/** What a design suits — for the counter and, later, the lens advisor. */
export const DESIGN_BEST_FOR = ['all-round', 'near', 'office', 'driving', 'outdoor', 'first-time'] as const;
export type DesignBestFor = typeof DESIGN_BEST_FOR[number];
export const DESIGN_LEVELS = ['basic', 'standard', 'premium'] as const;
export type DesignLevel = typeof DESIGN_LEVELS[number];

export interface ILensOption extends BaseDoc {
  kind: LensOptionKind;
  name: string;
  /** Code printed on lens slips (e.g. CR, PC, PG). '' = print nothing; missing = the built-in default. */
  shortName?: string;
  /** index: material name · design: lens type. */
  parent?: string | null;
  /** Legacy: per-company designs / palettes before they became shared (folded into `aliases` by migrateLensOptionBrands). */
  company?: string | null;
  /** The same entry under each company's own name, e.g. Crizal "Rock". */
  aliases?: BrandAlias[];
  /** design: what it is, in a line. */
  description?: string | null;
  /** design: what it suits. */
  bestFor?: DesignBestFor[];
  /** design: basic / standard / premium. */
  level?: DesignLevel | null;
  /** Swatch colour, '#rrggbb' (photoColor, tintColor, mirrorColor). */
  hex?: string | null;
  /** index: refractive index · tintStep: density % (solid) or top % (gradient). */
  value?: number | null;
  /** tintStep only. */
  style?: TintStyle | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const LensOption = createFirestoreModel<ILensOption>('lensoptions', { mirror: true });
