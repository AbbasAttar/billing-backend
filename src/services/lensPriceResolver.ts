/**
 * Prices any lens for one eye's Rx, trusting sources in this order (docs/lens-price-book-v2-plan.md):
 *   1. rule     — an exact LensPricing rule for the company + combination covers the Rx
 *   2. book     — the company's price book: base + power bands + coating + tint + cross axis
 *   3. purchase — latest purchase cost for the combination, sell price from the markup slabs
 *   4. missing  — nothing; the bill needs a manual price
 *
 * Pure: callers load rules, book, company and last cost. All amounts are per PAIR.
 */
import type { AxisType } from '../models/LensPricing.model';
import type { ILensPriceBook, BookBand, PricePart } from '../models/LensPriceBook.model';
import { LOCAL_COMPANY, type LensTier } from '../models/LensCompany.model';
import { pickBestRule, sphInRange, cylInRange, addInRange, type PowerRange } from './lensRuleMatch';

export interface MarkupSlab {
  /** Highest pair cost this slab applies to; null/undefined = no limit (the last slab). */
  upTo?: number | null;
  /** Sell = cost × x. */
  x: number;
}

export interface MarkupPolicy {
  slabs: MarkupSlab[];
  tierSlabs?: Partial<Record<LensTier, MarkupSlab[]>>;
  /** Lowest acceptable sell − cost per pair, in ₹. */
  minMarginPair: number;
  /** Sell is rounded up to a multiple of this (1 = no rounding). */
  roundTo: number;
}

export const DEFAULT_MARKUP: MarkupPolicy = {
  slabs: [{ upTo: 500, x: 3 }, { upTo: 2000, x: 2.5 }, { upTo: 5000, x: 2 }, { x: 1.6 }],
  minMarginPair: 300,
  roundTo: 50,
};

export interface EyeRx {
  sph: number;
  cyl: number;
  add: number | null;
  axisType?: AxisType;
}

export interface LensSpec {
  company?: string | null;
  lensType: string;
  material: string;
  coating: string;
  color: string;
}

export interface RuleLike extends PowerRange {
  _id?: unknown;
  lensType: string;
  material: string;
  coating: string;
  color: string;
  axisType?: string;
  company?: string | null;
  wholesaler?: string | null;
  price: number;
  costPrice: number;
}

export interface CompanyLike {
  name: string;
  tier: LensTier;
}

export type PriceSource = 'rule' | 'book' | 'purchase' | 'missing';

export interface PriceLine {
  label: string;
  cost: number;
  sell: number | null;
}

export interface PriceResult {
  source: PriceSource;
  cost: number | null;
  sell: number | null;
  breakdown: PriceLine[];
  ruleId?: string;
  /** False when sell − cost is under the minimum margin; null when either is unknown. */
  marginOk: boolean | null;
}

export interface ResolveContext {
  rules: RuleLike[];
  book?: ILensPriceBook | null;
  company?: CompanyLike | null;
  /** Latest purchase cost per pair for this company + combination, if any. */
  lastCost?: number | null;
  markup?: MarkupPolicy;
}

const same = (a: unknown, b: unknown) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** Older rules carry no company: the wholesaler they came from, else the shop's local lenses. */
export function ruleCompany(rule: Pick<RuleLike, 'company' | 'wholesaler'>): string {
  return rule.company || rule.wholesaler || LOCAL_COMPANY;
}

/** Ready axis = 180 ± 10 for plus cyl, 90 ± 10 for minus cyl; no cyl or no axis counts as ready. */
export function axisTypeFor(cyl: number | null | undefined, axis: number | null | undefined): AxisType {
  if (!cyl || Math.abs(cyl) < 0.25 || axis === null || axis === undefined) return 'ready';
  if (cyl > 0) return (axis >= 170 && axis <= 180) || (axis >= 0 && axis <= 10) ? 'ready' : 'cross';
  return axis >= 80 && axis <= 100 ? 'ready' : 'cross';
}

function slabsFor(policy: MarkupPolicy, tier?: LensTier | null): MarkupSlab[] {
  const own = tier ? policy.tierSlabs?.[tier] : undefined;
  return own && own.length ? own : policy.slabs;
}

/** Sell price for a pair cost: slab multiplier, at least cost + minimum margin, rounded up. */
export function applyMarkup(cost: number, policy: MarkupPolicy = DEFAULT_MARKUP, tier?: LensTier | null): number {
  const slabs = [...slabsFor(policy, tier)].sort(
    (a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity),
  );
  const slab = slabs.find((s) => s.upTo === null || s.upTo === undefined || cost <= s.upTo) ?? slabs[slabs.length - 1];
  const raw = Math.max(cost * (slab?.x ?? 1), cost + policy.minMarginPair);
  const step = policy.roundTo > 0 ? policy.roundTo : 1;
  return Math.ceil(raw / step) * step;
}

export function marginOk(cost: number | null, sell: number | null, policy: MarkupPolicy = DEFAULT_MARKUP): boolean | null {
  if (cost === null || sell === null) return null;
  return sell - cost >= policy.minMarginPair;
}

const bandWidth = (b: BookBand) => Math.abs(b.max - b.min);

/** Narrowest band covering the value, so boundary overlaps go to the more specific band. */
function pickBand(bands: BookBand[] | undefined, covers: (b: BookBand) => boolean): BookBand | null {
  const hits = (bands ?? []).filter(covers).sort((a, b) => bandWidth(a) - bandWidth(b));
  return hits[0] ?? null;
}

const fmt = (n: number) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));

/**
 * Adds up the book's parts for one eye. Returns null when the book does not cover the combination:
 * no base for type × material, SPH/CYL/ADD outside every band, coating not sold, or tint not listed.
 */
export function composeFromBook(book: ILensPriceBook, spec: LensSpec, rx: EyeRx): PriceLine[] | null {
  const lines: PriceLine[] = [];
  const add = (label: string, part: PricePart) => lines.push({ label, cost: part.cost, sell: part.sell ?? null });

  const base = book.bases?.find((b) => same(b.lensType, spec.lensType) && same(b.material, spec.material));
  if (!base) return null;
  add(`${spec.lensType} ${spec.material}`, base);

  const sph = pickBand(book.sphBands, (b) => sphInRange({ minSph: b.min, maxSph: b.max }, rx.sph));
  if (!sph) return null;
  add(`SPH ${fmt(sph.min)}..${fmt(sph.max)}`, sph);

  const cyl = pickBand(book.cylBands, (b) => cylInRange({ minCyl: b.min, maxCyl: b.max }, rx.cyl));
  if (!cyl) return null;
  add(`CYL ${Math.abs(cyl.min).toFixed(2)}..${Math.abs(cyl.max).toFixed(2)}`, cyl);

  if (rx.add !== null) {
    const addBand = pickBand(book.addBands, (b) => addInRange({ minAdd: b.min, maxAdd: b.max }, rx.add));
    if (!addBand) return null;
    add(`ADD ${addBand.min.toFixed(2)}..${addBand.max.toFixed(2)}`, addBand);
  }

  const coating = book.coatings?.find((c) => same(c.coating, spec.coating));
  if (!coating) return null;
  add(coating.coating, coating);

  if (!same(spec.color, 'White')) {
    const color = book.colors?.find((c) => same(c.color, spec.color));
    if (!color) return null;
    add(color.color, color);
  }

  if (rx.axisType === 'cross' && book.crossAxis) add('Cross axis', book.crossAxis);

  // Zero parts (the base band of each axis) are noise in the breakdown.
  return lines.filter((l, i) => i === 0 || l.cost !== 0 || (l.sell ?? 0) !== 0);
}

export function resolveLensPrice(spec: LensSpec, rx: EyeRx, ctx: ResolveContext): PriceResult {
  const policy = ctx.markup ?? DEFAULT_MARKUP;
  const companyName = spec.company || LOCAL_COMPANY;
  const tier = ctx.company?.tier ?? null;

  // 1. Exact rule
  const candidates = ctx.rules.filter(
    (r) =>
      same(ruleCompany(r), companyName) &&
      same(r.lensType, spec.lensType) &&
      same(r.material, spec.material) &&
      same(r.coating, spec.coating) &&
      same(r.color, spec.color),
  );
  const rule = pickBestRule(candidates, { sph: rx.sph, cyl: rx.cyl, add: rx.add, axisType: rx.axisType ?? 'any' });
  if (rule) {
    const cost = rule.costPrice > 0 ? rule.costPrice : null;
    return {
      source: 'rule',
      cost,
      sell: rule.price,
      breakdown: [{ label: 'Price rule', cost: rule.costPrice, sell: rule.price }],
      ruleId: rule._id !== undefined ? String(rule._id) : undefined,
      marginOk: marginOk(cost, rule.price, policy),
    };
  }

  // 2. Price book
  const lines = ctx.book ? composeFromBook(ctx.book, spec, rx) : null;
  if (lines) {
    const cost = lines.reduce((s, l) => s + l.cost, 0);
    // Price lists give wholesale price (cost) and SRP (sell) for each part; if any part has no SRP
    // the whole pair is marked up from cost instead.
    const allSell = lines.every((l) => l.sell !== null);
    const sell = allSell ? lines.reduce((s, l) => s + (l.sell as number), 0) : applyMarkup(cost, policy, tier);
    return { source: 'book', cost, sell, breakdown: lines, marginOk: marginOk(cost, sell, policy) };
  }

  // 3. Last purchase
  if (ctx.lastCost && ctx.lastCost > 0) {
    const sell = applyMarkup(ctx.lastCost, policy, tier);
    return {
      source: 'purchase',
      cost: ctx.lastCost,
      sell,
      breakdown: [{ label: 'Last purchase cost', cost: ctx.lastCost, sell }],
      marginOk: marginOk(ctx.lastCost, sell, policy),
    };
  }

  return { source: 'missing', cost: null, sell: null, breakdown: [], marginOk: null };
}
