/**
 * Loads what the lens price resolver needs, with a short cache: companies, price books and the
 * markup policy are small tables read on every bill line. Writes call invalidateLensPriceData().
 */
import { LensCompany, LOCAL_COMPANY, type ILensCompany } from '../models/LensCompany.model';
import { LensPriceBook, type ILensPriceBook } from '../models/LensPriceBook.model';
import { LensStock } from '../models/LensStock.model';
import { SiteSetting } from '../models/SiteSetting.model';
import { getLensPricingRulesCached } from './purchaseLookup';
import {
  DEFAULT_MARKUP,
  resolveLensPrice,
  type MarkupPolicy,
  type LensSpec,
  type EyeRx,
  type ResolveContext,
  type PriceResult,
} from './lensPriceResolver';

export const MARKUP_KEY = 'lens_markup';

const TTL_MS = 2 * 60 * 1000;
let cache: { companies: ILensCompany[]; books: ILensPriceBook[]; markup: MarkupPolicy; expiresAt: number } | null = null;

export function invalidateLensPriceData(): void {
  cache = null;
}

/** Stored policy over the defaults, so a partly filled setting still prices. */
export function mergeMarkup(stored: Partial<MarkupPolicy> | null | undefined): MarkupPolicy {
  return { ...DEFAULT_MARKUP, ...(stored ?? {}) };
}

export async function loadLensPriceData() {
  if (cache && cache.expiresAt > Date.now()) return cache;
  const [companies, books, setting] = await Promise.all([
    LensCompany.find({}).lean(),
    LensPriceBook.find({}).lean(),
    SiteSetting.findOne({ key: MARKUP_KEY }).lean(),
  ]);
  cache = {
    companies: companies as ILensCompany[],
    books: books as ILensPriceBook[],
    markup: mergeMarkup((setting as any)?.value),
    expiresAt: Date.now() + TTL_MS,
  };
  return cache;
}

const same = (a: unknown, b: unknown) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * Latest purchase cost per pair. Phase 1 reads LensStock.lastCost (per lens, exact power), which has
 * no company, so it only answers for Local lenses. Phase 4 adds company-aware purchase costs.
 */
async function lastPurchaseCost(spec: LensSpec, rx: EyeRx): Promise<number | null> {
  if (!same(spec.company || LOCAL_COMPANY, LOCAL_COMPANY)) return null;
  const stock: any = await LensStock.findOne({
    lensType: spec.lensType,
    material: spec.material,
    coating: spec.coating,
    color: spec.color,
    sph: rx.sph,
    cyl: rx.cyl,
    add: rx.add,
  }).lean();
  const perLens = Number(stock?.lastCost ?? stock?.costPrice);
  return perLens > 0 ? perLens * 2 : null;
}

export async function buildResolveContext(spec: LensSpec): Promise<ResolveContext> {
  const [rules, data] = await Promise.all([getLensPricingRulesCached(), loadLensPriceData()]);
  const name = spec.company || LOCAL_COMPANY;
  return {
    rules,
    company: data.companies.find((c) => same(c.name, name)) ?? null,
    book: data.books.find((b) => same(b.company, name)) ?? null,
    markup: data.markup,
  };
}

/** Resolves one eye; the stock read for a last purchase cost only happens when rule and book both miss. */
export async function resolveEye(spec: LensSpec, rx: EyeRx, ctx?: ResolveContext): Promise<PriceResult> {
  const base = ctx ?? (await buildResolveContext(spec));
  const first = resolveLensPrice(spec, rx, base);
  if (first.source !== 'missing') return first;
  const lastCost = await lastPurchaseCost(spec, rx);
  return lastCost ? resolveLensPrice(spec, rx, { ...base, lastCost }) : first;
}
