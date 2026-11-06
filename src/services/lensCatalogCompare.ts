/**
 * Lens catalogue comparison (docs/lens-price-book-v2-plan.md, "Lens catalogue v3").
 * Prescription first: it decides the lens type and the thinnest sensible index; then every company's
 * product that covers both eyes is priced with its cheapest fitting index + coating, adding a company
 * add-on when the wanted feature isn't built in. Pure — callers load the catalogue.
 */
import type {
  CatalogLensType,
  IBrandCoating,
  ILensAddon,
  ILensProduct,
  LensFeature,
  ProductRow,
  ProductTier,
} from '../models/LensCatalog.model';
import { PRODUCT_TIERS } from '../models/LensCatalog.model';

export const COATING_CLASSES = ['HC', 'AR', 'AR+', 'Blue', 'Drive'] as const;
export type CoatingClass = typeof COATING_CLASSES[number];

/** HC → AR → AR+ (water / smudge repel) → Blue → Drive, from the coating's ticked features. */
export function coatingClass(features: LensFeature[]): CoatingClass {
  if (features.includes('nightDrive')) return 'Drive';
  if (features.includes('blueFilter')) return 'Blue';
  if (features.includes('antiReflection') && features.includes('waterRepel')) return 'AR+';
  if (features.includes('antiReflection')) return 'AR';
  return 'HC';
}

export interface IndexStep {
  /** Strongest power (either eye, worst meridian) up to which this index is enough. */
  upTo: number;
  index: number;
}

export interface CatalogSettings {
  indexByPower: IndexStep[];
  /** Above this power the thinnest index is used and lenticular products are allowed. */
  maxIndex: number;
  lenticularAbove: number;
}

/** Placeholder steps until the owner sets their own (Lens Config). */
export const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  indexByPower: [
    { upTo: 2, index: 1.5 },
    { upTo: 4, index: 1.56 },
    { upTo: 6, index: 1.6 },
    { upTo: 8, index: 1.67 },
  ],
  maxIndex: 1.74,
  lenticularAbove: 8,
};

export interface EyeRx {
  sph?: number | null;
  cyl?: number | null;
  axis?: number | null;
  add?: number | null;
}

export interface RxInput {
  right?: EyeRx | null;
  left?: EyeRx | null;
}

export interface RxNeeds {
  /** Lens types this prescription may be made in: with an ADD never single vision. */
  types: CatalogLensType[];
  suggestedType: CatalogLensType;
  /** Strongest power, either eye, worst meridian (size). */
  maxPower: number;
  maxCyl: number;
  maxAdd: number;
  minIndex: number;
  lenticular: boolean;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/**
 * Each eye in minus-cyl form, the way supplier ranges are printed: a plus-cyl Rx (+1.00 / +2.00)
 * transposes to +3.00 / −2.00, so it is matched against SPH +3.00. Row cyl is a size, sign ignored.
 */
const eyes = (rx: RxInput): Required<Pick<EyeRx, 'sph' | 'cyl' | 'add'>>[] =>
  [rx.right, rx.left]
    .filter((e): e is EyeRx => Boolean(e))
    .map((e) => {
      const sph = num(e.sph);
      const cyl = num(e.cyl);
      return cyl > 0 ? { sph: sph + cyl, cyl: -cyl, add: num(e.add) } : { sph, cyl, add: num(e.add) };
    });

export function rxNeeds(rx: RxInput, settings: CatalogSettings = DEFAULT_CATALOG_SETTINGS): RxNeeds {
  const list = eyes(rx);
  const maxPower = Math.max(0, ...list.map((e) => Math.max(Math.abs(e.sph), Math.abs(e.sph + e.cyl))));
  const maxCyl = Math.max(0, ...list.map((e) => Math.abs(e.cyl)));
  const maxAdd = Math.max(0, ...list.map((e) => e.add));
  const step = [...settings.indexByPower].sort((a, b) => a.upTo - b.upTo).find((s) => maxPower <= s.upTo);
  const types: CatalogLensType[] = maxAdd > 0 ? ['Progressive', 'Bifocal', 'Office'] : ['Single Vision'];
  return {
    types,
    suggestedType: types[0],
    maxPower,
    maxCyl,
    maxAdd,
    minIndex: step ? step.index : settings.maxIndex,
    lenticular: maxPower > settings.lenticularAbove,
  };
}

const EPS = 0.001;

/** The row covers every eye: SPH inside its range, CYL within its size, ADD within its range when it has one. */
export function rowCovers(row: ProductRow, rx: RxInput): boolean {
  const list = eyes(rx);
  if (!list.length) return false;
  const lo = Math.min(row.minSph, row.maxSph);
  const hi = Math.max(row.minSph, row.maxSph);
  return list.every((e) => {
    if (e.sph < lo - EPS || e.sph > hi + EPS) return false;
    if (Math.abs(e.cyl) > Math.abs(row.maxCyl) + EPS) return false;
    if (e.add > 0 && row.minAdd != null && row.maxAdd != null) {
      if (e.add < row.minAdd - EPS || e.add > row.maxAdd + EPS) return false;
    }
    return true;
  });
}

export interface CompareFilter {
  type: CatalogLensType;
  tier?: ProductTier | null;
  minCoatingClass?: CoatingClass | null;
  /** Features the customer wants (blue filter, photochromic…). */
  features?: LensFeature[];
  /** Only these companies; empty = all. */
  companies?: string[];
}

export interface OfferAddon {
  id: string;
  name: string;
  kind: 'fixed' | 'percent';
  srp: number;
  cost: number;
  feature: LensFeature | null;
}

export interface Offer {
  productId: string;
  company: string;
  product: string;
  range: string | null;
  tier: ProductTier;
  design: string | null;
  note: string | null;
  index: number;
  coatingId: string;
  coating: string;
  coatingClass: CoatingClass;
  coatingFeatures: LensFeature[];
  productFeatures: LensFeature[];
  /** Add-ons included because a wanted feature isn't built in. */
  addons: OfferAddon[];
  /** Other add-ons that fit, not included in the price. */
  optionalAddons: OfferAddon[];
  srp: number;
  cost: number;
  /** Variants of this product (shown grouped when no feature is asked for). */
  variants: { productId: string; product: string; features: LensFeature[]; srp: number }[];
  /** True when this product has no row at the advised index for the power, so this lens is thicker than advised. */
  belowAdvisedIndex: boolean;
  /** A cheaper, thinner-than-advised index of the same product, offered as a choice. */
  thickerOption: { index: number; coating: string; srp: number } | null;
}

export interface Catalog {
  products: ILensProduct[];
  coatings: IBrandCoating[];
  addons: ILensAddon[];
}

const id = (d: { _id?: unknown }) => String(d._id);
const same = (a?: string | null, b?: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

export function addonFits(addon: ILensAddon, product: ILensProduct, coatingId: string): boolean {
  if (!same(addon.company, product.company)) return false;
  if (addon.productIds?.length && !addon.productIds.includes(id(product))) return false;
  if (addon.coatingIds?.length && !addon.coatingIds.includes(coatingId)) return false;
  if (addon.excludeCoatingIds?.includes(coatingId)) return false;
  return true;
}

const toOfferAddon = (a: ILensAddon): OfferAddon => ({
  id: id(a),
  name: a.name,
  kind: a.kind,
  srp: a.srp,
  cost: a.cost,
  feature: a.feature ?? null,
});

/** Price after add-ons: fixed ones add, percent ones scale the lens price and cost. */
export function priceWith(srp: number, cost: number, addons: OfferAddon[]): { srp: number; cost: number } {
  let s = srp;
  let c = cost;
  for (const a of addons.filter((x) => x.kind === 'fixed')) { s += a.srp; c += a.cost; }
  for (const a of addons.filter((x) => x.kind === 'percent')) { s *= 1 + a.srp / 100; c *= 1 + a.srp / 100; }
  return { srp: Math.round(s), cost: Math.round(c) };
}

/** Cheapest fitting index + coating of one product, or null when nothing fits. */
function bestOffer(product: ILensProduct, catalog: Catalog, rx: RxInput, needs: RxNeeds, filter: CompareFilter): Offer | null {
  const minClass = filter.minCoatingClass ? COATING_CLASSES.indexOf(filter.minCoatingClass) : 0;
  const wanted = filter.features ?? [];
  const isLenticular = same(product.design, 'Lenticular') || /lenticular/i.test(product.name);
  // The index-by-power steps advise, they don't hide: thinner-than-advised rows still sell, flagged.
  let best: Offer | null = null;
  let thick: Offer | null = null;

  for (const row of product.rows ?? []) {
    if (!rowCovers(row, rx)) continue;
    const advised = row.index >= needs.minIndex - EPS || (isLenticular && needs.lenticular);
    for (const [coatingId, price] of Object.entries(row.prices ?? {})) {
      const coating = catalog.coatings.find((c) => id(c) === coatingId && same(c.company, product.company));
      if (!coating || !(price?.srp > 0)) continue;
      const cls = coatingClass(coating.features ?? []);
      if (COATING_CLASSES.indexOf(cls) < minClass) continue;

      const have = new Set<LensFeature>([...(product.features ?? []), ...(coating.features ?? [])]);
      const fitting = catalog.addons.filter((a) => addonFits(a, product, coatingId));
      const included: OfferAddon[] = [];
      let ok = true;
      for (const f of wanted) {
        if (have.has(f)) continue;
        const cheapest = fitting
          .filter((a) => a.feature === f)
          .sort((a, b) => a.srp - b.srp)[0];
        if (!cheapest) { ok = false; break; }
        included.push(toOfferAddon(cheapest));
        have.add(f);
      }
      if (!ok) continue;

      const total = priceWith(price.srp, price.cost ?? 0, included);
      const current = advised ? best : thick;
      if (current && total.srp >= current.srp) continue;
      const offer: Offer = {
        productId: id(product),
        company: product.company,
        product: product.name,
        range: product.range ?? null,
        tier: product.tier,
        design: product.design ?? null,
        note: product.note ?? null,
        index: row.index,
        coatingId,
        coating: coating.name,
        coatingClass: cls,
        coatingFeatures: coating.features ?? [],
        productFeatures: product.features ?? [],
        addons: included,
        optionalAddons: fitting.filter((a) => !included.some((x) => x.id === id(a))).map(toOfferAddon),
        srp: total.srp,
        cost: total.cost,
        variants: [],
        belowAdvisedIndex: !advised,
        thickerOption: null,
      };
      if (advised) best = offer;
      else thick = offer;
    }
  }
  if (!best) return thick;
  if (thick && thick.srp < best.srp) best.thickerOption = { index: thick.index, coating: thick.coating, srp: thick.srp };
  return best;
}

export function compareLenses(catalog: Catalog, rx: RxInput, filter: CompareFilter, settings?: CatalogSettings) {
  const needs = rxNeeds(rx, settings);
  if (!needs.types.includes(filter.type)) return { needs, offers: [] as Offer[], hidden: 0 };
  const products = catalog.products.filter(
    (p) =>
      p.active !== false &&
      p.lensType === filter.type &&
      (!filter.tier || p.tier === filter.tier) &&
      (!filter.companies?.length || filter.companies.some((c) => same(c, p.company))),
  );

  const offers: Offer[] = [];
  let hidden = 0;
  for (const p of products) {
    const o = bestOffer(p, catalog, rx, needs, filter);
    if (o) offers.push(o);
    else hidden++;
  }

  // With no feature asked for, fold variants under their base product so the list stays short.
  if (!filter.features?.length) {
    for (const v of offers.filter((o) => catalog.products.find((p) => id(p) === o.productId)?.variantOf)) {
      const baseId = catalog.products.find((p) => id(p) === v.productId)!.variantOf!;
      const base = offers.find((o) => o.productId === baseId);
      if (!base) continue;
      base.variants.push({ productId: v.productId, product: v.product, features: v.productFeatures, srp: v.srp });
      offers.splice(offers.indexOf(v), 1);
    }
  }

  offers.sort((a, b) => a.srp - b.srp || PRODUCT_TIERS.indexOf(a.tier) - PRODUCT_TIERS.indexOf(b.tier));
  return { needs, offers, hidden };
}

export interface QuoteInput {
  /** Defaults to the Local company (the old price rules). */
  company?: string | null;
  lensType: string;
  coating: string;
  /** Exact index when the bill has one; otherwise any index of the material. */
  index?: number | null;
  material?: string | null;
  photochromic: boolean;
  rx: RxInput;
}

export interface Quote {
  productId: string;
  product: string;
  index: number;
  coatingId: string;
  coating: string;
  /** Per pair. */
  srp: number;
  cost: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const materialFits = (index: number, material: string) => {
  if (/poly/i.test(material)) return near(index, 1.59);
  if (/glass/i.test(material)) return near(index, 1.52) || near(index, 1.53);
  return !near(index, 1.59) && !near(index, 1.52) && !near(index, 1.53);
};

/**
 * The bill's lens pickers (type, material or index, coating, colour) priced from the catalogue: the cheapest
 * line of that company that fits every eye given. Replaces the old Lens Pricing Rules lookup.
 */
export function quoteLens(catalog: Catalog, q: QuoteInput): Quote | null {
  const company = q.company?.trim() || 'Local';
  const coatingIds = new Set(
    catalog.coatings.filter((c) => same(c.company, company) && same(c.name, q.coating)).map(id),
  );
  if (!coatingIds.size) return null;
  let best: Quote | null = null;
  for (const p of catalog.products) {
    if (p.active === false || !same(p.company, company) || !same(p.lensType, q.lensType)) continue;
    if ((p.features ?? []).includes('photochromic') !== q.photochromic) continue;
    for (const row of p.rows ?? []) {
      if (q.index != null ? !near(row.index, q.index) : q.material ? !materialFits(row.index, q.material) : false) continue;
      if (!rowCovers(row, q.rx)) continue;
      for (const [coatingId, price] of Object.entries(row.prices ?? {})) {
        if (!coatingIds.has(coatingId) || !(price?.srp > 0)) continue;
        if (best && price.srp >= best.srp) continue;
        best = {
          productId: id(p),
          product: p.name,
          index: row.index,
          coatingId,
          coating: catalog.coatings.find((c) => id(c) === coatingId)?.name ?? q.coating,
          srp: price.srp,
          cost: price.cost ?? 0,
        };
      }
    }
  }
  return best;
}
