/**
 * Moves the old Lens Pricing Rules into the lens catalogue as the "Local" company (owner decision, Nov 2026):
 * every rule becomes one price line of a Local product, its coating a Local brand coating.
 *
 * - Hand-entered rules grouped by type + material + colour become one product each ("Local SV Fiber").
 * - Imported wholesaler rules keep their brand as the product name (needed when ordering); "High Cyl", "Plus" and
 *   "High Power" are only wider power ranges of the same lens, so they join their base brand.
 * - Photochromic rules become their own product with the photochromic feature, a variant of the white one.
 * - Index comes from the coating or brand name (1.60, 1.67…), else from the material.
 * - Prices are per pair. Hand rules not yet marked per pair were per lens, so they are doubled (same rule as
 *   scripts/migrateLensPricingPerPair.ts).
 */
import type { CatalogLensType, IBrandCoating, ILensProduct, LensFeature, ProductRow, ProductTier } from '../models/LensCatalog.model';

export const LOCAL = 'Local';

export interface OldRule {
  _id?: unknown;
  lensType: string;
  material: string;
  coating: string;
  color: string;
  minSph: number;
  maxSph: number;
  minCyl: number;
  maxCyl: number;
  minAdd?: number | null;
  maxAdd?: number | null;
  price: number;
  costPrice?: number | null;
  brand?: string | null;
  wholesaler?: string | null;
  dia?: string | null;
  priceUnit?: string | null;
}

export type CoatingPlan = Pick<IBrandCoating, 'company' | 'name' | 'features'>;
export type ProductPlan = Omit<ILensProduct, '_id' | 'rows' | 'variantOf'> & {
  key: string;
  variantOfKey: string | null;
  rows: (Omit<ProductRow, 'prices'> & { coating: string; srp: number; cost: number })[];
};

const PHOTO = /photo/i;

/** Old colour field: anything photochromic counts, the rest is a clear lens. */
export const isPhotoColor = (color?: string | null) => PHOTO.test(color ?? '');

/** Feature ticks guessed from a coating name; the owner fixes them later in Lens Config. */
export function featuresFromCoatingName(name: string): LensFeature[] {
  const n = name.toLowerCase();
  const f = new Set<LensFeature>(['hardCoat']);
  if (/hmc|multi|anti[- ]?(reflect|glare)|\bar\b|shmc|drive|freeform/.test(n)) f.add('antiReflection');
  if (/hydro|shmc|\+/.test(n)) { f.add('waterRepel'); f.add('antiReflection'); }
  if (/blue/.test(n)) { f.add('blueFilter'); f.add('antiReflection'); }
  if (/drive/.test(n)) f.add('nightDrive');
  if (/uv/.test(n)) f.add('uv');
  return [...f];
}

/** Index written in a coating or brand name (1.60, 1.67…), else the material's usual one. */
export function indexFor(material: string, ...names: (string | null | undefined)[]): number {
  for (const n of names) {
    const m = /\b1\.(5[0-9]|6[0-9]|7[0-9])\b/.exec(n ?? '');
    if (m) return Number(`1.${m[1]}`);
  }
  if (/poly/i.test(material)) return 1.59;
  if (/glass/i.test(material)) return 1.52;
  return 1.56;
}

const TYPE_SHORT: Record<string, string> = { 'Single Vision': 'SV', Bifocal: 'Bifocal', Progressive: 'Progressive', Office: 'Office' };
const BANDS: Record<CatalogLensType, [number, number, number]> = {
  'Single Vision': [1500, 4000, 10000],
  Bifocal: [2000, 5000, 12000],
  Progressive: [5000, 12000, 30000],
  Office: [4000, 10000, 25000],
};

function tierFor(type: CatalogLensType, cheapest: number): ProductTier {
  const [a, b, c] = BANDS[type];
  return cheapest < a ? 'Entry' : cheapest < b ? 'Mid' : cheapest < c ? 'Premium' : 'Top';
}

/** "Scratch Guard 56 High Cyl" and "… Plus" are wider ranges of "Scratch Guard 56". */
const baseBrand = (brand: string) => brand.replace(/\s+(high\s+cyl|high\s+power|plus)$/i, '').trim();

const lensTypeOf = (t: string): CatalogLensType =>
  (['Single Vision', 'Bifocal', 'Progressive', 'Office'] as const).find((x) => x.toLowerCase() === t.toLowerCase()) ?? 'Single Vision';

/** Per pair: hand rules not yet stamped per pair were entered per lens. */
export function pairPrice(rule: OldRule): { srp: number; cost: number } {
  const perLens = !rule.wholesaler && rule.priceUnit !== 'pair';
  const k = perLens ? 2 : 1;
  return { srp: Math.round((rule.price ?? 0) * k), cost: Math.round((rule.costPrice ?? 0) * k) };
}

export function planFromRules(rules: OldRule[]): { coatings: CoatingPlan[]; products: ProductPlan[] } {
  const coatings = new Map<string, CoatingPlan>();
  const products = new Map<string, ProductPlan>();

  for (const r of rules) {
    if (!(r.price > 0) || !r.coating) continue;
    const type = lensTypeOf(r.lensType);
    const photo = isPhotoColor(r.color);
    const brand = r.brand?.trim() ? baseBrand(r.brand) : null;
    const name = brand ?? `Local ${TYPE_SHORT[type]} ${r.material}`;
    const key = [type, r.material, name].join('|').toLowerCase();
    const productKey = photo ? `${key}|photo` : key;

    const cKey = r.coating.trim().toLowerCase();
    if (!coatings.has(cKey)) coatings.set(cKey, { company: LOCAL, name: r.coating.trim(), features: featuresFromCoatingName(r.coating) });

    let p = products.get(productKey);
    if (!p) {
      p = {
        key: productKey,
        variantOfKey: null,
        company: LOCAL,
        name: photo ? `${name} Photo` : name,
        range: null,
        lensType: type,
        tier: 'Entry',
        design: null,
        features: photo ? ['photochromic'] : [],
        note: r.wholesaler ? `From the old price rules (via ${r.wholesaler})` : 'From the old price rules',
        active: true,
        rows: [],
      };
      products.set(productKey, p);
    }
    const { srp, cost } = pairPrice(r);
    const hasAdd = r.minAdd !== null && r.minAdd !== undefined;
    p.rows.push({
      coating: r.coating.trim(),
      index: indexFor(r.material, r.coating, r.brand),
      minSph: r.minSph,
      maxSph: r.maxSph,
      maxCyl: Math.max(Math.abs(r.minCyl ?? 0), Math.abs(r.maxCyl ?? 0)),
      minAdd: hasAdd ? (r.minAdd as number) : null,
      maxAdd: hasAdd ? ((r.maxAdd ?? r.minAdd) as number) : null,
      dia: r.dia ?? null,
      engraving: null,
      srp,
      cost,
    });
  }

  for (const p of products.values()) {
    p.tier = tierFor(p.lensType, Math.min(...p.rows.map((r) => r.srp)));
    if (p.key.endsWith('|photo')) {
      const base = p.key.slice(0, -'|photo'.length);
      if (products.has(base)) p.variantOfKey = base;
    }
  }
  return { coatings: [...coatings.values()], products: [...products.values()] };
}
