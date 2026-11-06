import { NextFunction, Request, Response } from 'express';
import {
  BrandCoating,
  LensProduct,
  LensAddon,
  LENS_FEATURES,
  COATING_FEATURES,
  CATALOG_LENS_TYPES,
  PRODUCT_TIERS,
  type LensFeature,
  type ProductRow,
  type IBrandCoating,
  type ILensProduct,
  type ILensAddon,
} from '../models/LensCatalog.model';
import { SiteSetting } from '../models/SiteSetting.model';
import { fail, ok } from '../utils/response';
import { loadLensPriceData } from '../services/lensPriceData';
import {
  compareLenses,
  quoteLens,
  COATING_CLASSES,
  DEFAULT_CATALOG_SETTINGS,
  type CatalogSettings,
  type IndexStep,
} from '../services/lensCatalogCompare';

/** Lens catalogue v3: each company's coatings, products and add-ons, and the counter comparison. */

const SETTINGS_KEY = 'lens_catalog';

export interface LensCatalogSettings extends CatalogSettings {
  /** What each tier means, in words for the customer. */
  tierMeanings: Record<string, string>;
  /** What each index gives, keyed "1.60". */
  indexMeanings: Record<string, string>;
}

const DEFAULT_SETTINGS: LensCatalogSettings = {
  ...DEFAULT_CATALOG_SETTINGS,
  tierMeanings: {
    Entry: 'Basic lens: clear at the main distances, narrower side vision; takes a few days to get used to.',
    Mid: 'Wider clear zones and softer sides than entry; easier to adapt to.',
    Premium: 'Large clear zones and natural head movement with little side blur; for all-day wear.',
    Top: "The brand's best design, often made to the wearer's measurements; sharpest and quickest to adapt.",
  },
  indexMeanings: {
    '1.50': 'Standard lens material.',
    '1.56': 'Slightly thinner and lighter than standard.',
    '1.59': 'Polycarbonate: thin, light and impact resistant; good for children, sports and rimless.',
    '1.60': 'Thinner and lighter than standard; neater edges in medium powers.',
    '1.67': 'High index: much thinner for higher powers or rimless frames.',
    '1.74': 'Thinnest available, for very high powers.',
  },
};

class BadInput extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const clean = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const same = (a: unknown, b: unknown) => clean(a).toLowerCase() === clean(b).toLowerCase();
const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function text(v: unknown, field: string, max: number, required = false): string | null {
  const s = clean(v);
  if (required && !s) throw new BadInput(`${field} is required`);
  if (s.length > max) throw new BadInput(`${field} must be at most ${max} characters`);
  return s || null;
}

const features = (v: unknown, allowed: readonly LensFeature[]): LensFeature[] =>
  Array.isArray(v) ? allowed.filter((f) => v.includes(f)) : [];

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => clean(x)).filter(Boolean) : []);

// ── Cache: three small mirrored collections, read on every comparison ──────

const TTL_MS = 2 * 60 * 1000;
let cache: { coatings: IBrandCoating[]; products: ILensProduct[]; addons: ILensAddon[]; settings: LensCatalogSettings; at: number } | null = null;

async function loadCatalog() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const [coatings, products, addons, setting] = await Promise.all([
    BrandCoating.find().lean(),
    LensProduct.find().lean(),
    LensAddon.find().lean(),
    SiteSetting.findOne({ key: SETTINGS_KEY }).lean(),
  ]);
  const stored = ((setting as any)?.value ?? {}) as Partial<LensCatalogSettings>;
  cache = {
    coatings: coatings as IBrandCoating[],
    products: products as ILensProduct[],
    addons: addons as ILensAddon[],
    settings: {
      ...DEFAULT_SETTINGS,
      ...stored,
      tierMeanings: { ...DEFAULT_SETTINGS.tierMeanings, ...(stored.tierMeanings ?? {}) },
      indexMeanings: { ...DEFAULT_SETTINGS.indexMeanings, ...(stored.indexMeanings ?? {}) },
    },
    at: Date.now(),
  };
  return cache;
}

const invalidate = () => { cache = null; };

async function readCompany(v: unknown): Promise<string> {
  const name = text(v, 'company', 60, true)!;
  const { companies } = await loadLensPriceData();
  const hit = companies.find((c) => same(c.name, name));
  if (!hit) throw new BadInput('Unknown company — add it under Companies first');
  return hit.name;
}

const sendError = (res: Response, next: NextFunction, e: unknown) =>
  e instanceof BadInput ? fail(res, e.message, e.status) : next(e);

// GET /lens-catalog
export const getCatalog = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { coatings, products, addons, settings } = await loadCatalog();
    const byName = (a: { company: string; name: string }, b: { company: string; name: string }) =>
      a.company.localeCompare(b.company) || a.name.localeCompare(b.name);
    return ok(res, {
      coatings: [...coatings].sort(byName),
      products: [...products].sort(byName),
      addons: [...addons].sort(byName),
      settings,
      features: LENS_FEATURES,
      coatingFeatures: COATING_FEATURES,
      coatingClasses: COATING_CLASSES,
    });
  } catch (e) { next(e); }
};

// PUT /lens-catalog/settings { indexByPower?, maxIndex?, lenticularAbove?, tierMeanings?, indexMeanings? }
export const putSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = req.body ?? {};
    const { settings: current } = await loadCatalog();
    const next_: LensCatalogSettings = { ...current };
    if (b.indexByPower !== undefined) {
      if (!Array.isArray(b.indexByPower) || !b.indexByPower.length) throw new BadInput('indexByPower needs at least one step');
      next_.indexByPower = b.indexByPower.map((s: IndexStep, i: number) => {
        if (!isAmount(s?.upTo) || !isNum(s?.index)) throw new BadInput(`step ${i + 1}: power and index are required`);
        return { upTo: s.upTo, index: s.index };
      }).sort((a: IndexStep, c: IndexStep) => a.upTo - c.upTo);
    }
    if (b.maxIndex !== undefined) { if (!isNum(b.maxIndex)) throw new BadInput('maxIndex must be a number'); next_.maxIndex = b.maxIndex; }
    if (b.lenticularAbove !== undefined) { if (!isAmount(b.lenticularAbove)) throw new BadInput('lenticularAbove must be >= 0'); next_.lenticularAbove = b.lenticularAbove; }
    for (const key of ['tierMeanings', 'indexMeanings'] as const) {
      if (b[key] === undefined) continue;
      if (typeof b[key] !== 'object' || b[key] === null) throw new BadInput(`${key} must be an object`);
      next_[key] = { ...current[key] };
      for (const [k, v] of Object.entries(b[key])) next_[key][clean(k)] = text(v, `${key}.${k}`, 200) ?? '';
    }
    await SiteSetting.findOneAndUpdate({ key: SETTINGS_KEY }, { $set: { value: next_ } }, { upsert: true, new: true });
    invalidate();
    return ok(res, next_, 'Saved');
  } catch (e) { sendError(res, next, e); }
};

// ── Brand coatings ──────────────────────────────────────────────────────────

async function readCoating(body: any, existingId?: string) {
  const company = await readCompany(body.company);
  const name = text(body.name, 'name', 60, true)!;
  const { coatings } = await loadCatalog();
  if (coatings.some((c) => String(c._id) !== existingId && same(c.company, company) && same(c.name, name))) {
    throw new BadInput(`${company} already has a coating called ${name}`, 409);
  }
  return {
    company,
    name,
    shortName: text(body.shortName, 'short name', 12),
    features: features(body.features, COATING_FEATURES),
    note: text(body.note, 'note', 200),
  };
}

export const createCoating = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await BrandCoating.create(await readCoating(req.body ?? {}));
    invalidate();
    return ok(res, doc, 'Coating added', 201);
  } catch (e) { sendError(res, next, e); }
};

export const updateCoating = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc: any = await BrandCoating.findById(req.params.id);
    if (!doc) return fail(res, 'Not found', 404);
    const fields = await readCoating({ ...doc.toObject?.() ?? doc, ...(req.body ?? {}) }, String(doc._id));
    if (!same(fields.company, doc.company)) return fail(res, "A coating can't move to another company", 400);
    Object.assign(doc, fields);
    await doc.save();
    invalidate();
    return ok(res, doc, 'Updated');
  } catch (e) { sendError(res, next, e); }
};

export const deleteCoating = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const { products, addons } = await loadCatalog();
    const usedBy = products.filter((p) => (p.rows ?? []).some((r) => r.prices && id in r.prices)).map((p) => p.name);
    if (usedBy.length) return fail(res, `Remove its prices first — used by ${usedBy.slice(0, 3).join(', ')}${usedBy.length > 3 ? '…' : ''}`, 409);
    if (addons.some((a) => a.coatingIds?.includes(id) || a.excludeCoatingIds?.includes(id))) return fail(res, 'An add-on refers to this coating', 409);
    const doc = await BrandCoating.findByIdAndDelete(id);
    if (!doc) return fail(res, 'Not found', 404);
    invalidate();
    return ok(res, { _id: id }, 'Deleted');
  } catch (e) { next(e); }
};

// ── Products ────────────────────────────────────────────────────────────────

function readRows(v: unknown, coatingIds: Set<string>): ProductRow[] {
  if (!Array.isArray(v)) return [];
  const rows = v.map((r: any, i: number) => {
    const where = `index row ${i + 1}`;
    const index = Number(r?.index);
    if (!Number.isFinite(index) || index < 1.4 || index > 2) throw new BadInput(`${where}: index must be a number like 1.60`);
    for (const k of ['minSph', 'maxSph', 'maxCyl'] as const) if (!isNum(r?.[k])) throw new BadInput(`${where}: ${k} is required`);
    const hasAdd = r.minAdd !== null && r.minAdd !== undefined && r.minAdd !== '';
    if (hasAdd && (!isAmount(r.minAdd) || !isAmount(r.maxAdd))) throw new BadInput(`${where}: ADD range must be numbers`);
    const prices: ProductRow['prices'] = {};
    for (const [cid, p] of Object.entries(r?.prices ?? {})) {
      if (!coatingIds.has(cid)) throw new BadInput(`${where}: price for a coating this company doesn't have`);
      const { srp, cost } = (p ?? {}) as any;
      if (srp === null || srp === undefined || srp === '') continue; // blank = not sold with this coating
      if (!isAmount(srp)) throw new BadInput(`${where}: SRP must be >= 0`);
      if (cost !== undefined && cost !== null && cost !== '' && !isAmount(cost)) throw new BadInput(`${where}: cost must be >= 0`);
      prices[cid] = { srp, cost: isAmount(cost) ? cost : 0 };
    }
    // Kept as the price list prints them (+4 to 0, cyl −2); matching uses the range and the cyl size.
    return {
      index,
      minSph: r.minSph,
      maxSph: r.maxSph,
      maxCyl: r.maxCyl,
      minAdd: hasAdd ? Math.min(r.minAdd, r.maxAdd) : null,
      maxAdd: hasAdd ? Math.max(r.minAdd, r.maxAdd) : null,
      dia: text(r.dia, `${where} dia`, 20),
      engraving: text(r.engraving, `${where} engraving`, 20),
      prices,
    };
  }).sort((a, b) => a.index - b.index || Math.min(a.minSph, a.maxSph) - Math.min(b.minSph, b.maxSph));
  // Ranges may overlap: a narrow cheap range (−6 to 0) and a wider dearer one (−8 to 0). The comparison quotes the
  // cheapest row that fits the prescription. Only the very same line entered twice is a mistake.
  rows.forEach((a, i) => rows.slice(i + 1).forEach((b) => {
    if (sameLine(a, b)) throw new BadInput(`index ${a.index.toFixed(2)}: SPH ${b.minSph} to ${b.maxSph}, cyl ${b.maxCyl}, dia ${b.dia ?? '-'} is entered twice for the same coating`);
  }));
  return rows;
}

/** Same coating, index, power range, cyl size, ADD range and dia. */
function sameLine(a: ProductRow, b: ProductRow): boolean {
  if (!Object.keys(a.prices).some((c) => c in b.prices)) return false;
  if (a.index !== b.index || Math.abs(a.maxCyl) !== Math.abs(b.maxCyl)) return false;
  if ((a.dia ?? '').trim().toLowerCase() !== (b.dia ?? '').trim().toLowerCase()) return false;
  const lo = (r: ProductRow) => Math.min(r.minSph, r.maxSph);
  const hi = (r: ProductRow) => Math.max(r.minSph, r.maxSph);
  return lo(a) === lo(b) && hi(a) === hi(b) && (a.minAdd ?? null) === (b.minAdd ?? null) && (a.maxAdd ?? null) === (b.maxAdd ?? null);
}

async function readProduct(body: any, existingId?: string) {
  const company = await readCompany(body.company);
  const name = text(body.name, 'name', 80, true)!;
  const { products, coatings } = await loadCatalog();
  if (products.some((p) => String(p._id) !== existingId && same(p.company, company) && same(p.name, name))) {
    throw new BadInput(`${company} already has a product called ${name}`, 409);
  }
  if (!CATALOG_LENS_TYPES.includes(body.lensType)) throw new BadInput('Pick the lens type');
  if (!PRODUCT_TIERS.includes(body.tier)) throw new BadInput('Pick the tier');
  let variantOf: string | null = clean(body.variantOf) || null;
  if (variantOf) {
    const base = products.find((p) => String(p._id) === variantOf);
    if (!base || !same(base.company, company)) throw new BadInput('A variant must be of a product from the same company');
    if (variantOf === existingId) variantOf = null;
  }
  const companyCoatings = new Set(coatings.filter((c) => same(c.company, company)).map((c) => String(c._id)));
  return {
    company,
    name,
    range: text(body.range, 'range', 60),
    lensType: body.lensType,
    tier: body.tier,
    design: text(body.design, 'design', 40),
    features: features(body.features, LENS_FEATURES),
    variantOf,
    note: text(body.note, 'note', 200),
    rows: readRows(body.rows, companyCoatings),
    active: body.active !== false,
  };
}

export const createProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await LensProduct.create(await readProduct(req.body ?? {}));
    invalidate();
    return ok(res, doc, 'Product added', 201);
  } catch (e) { sendError(res, next, e); }
};

export const updateProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc: any = await LensProduct.findById(req.params.id);
    if (!doc) return fail(res, 'Not found', 404);
    const fields = await readProduct({ ...doc.toObject?.() ?? doc, ...(req.body ?? {}) }, String(doc._id));
    if (!same(fields.company, doc.company)) return fail(res, "A product can't move to another company", 400);
    Object.assign(doc, fields);
    await doc.save();
    invalidate();
    return ok(res, doc, 'Updated');
  } catch (e) { sendError(res, next, e); }
};

export const deleteProduct = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const { products } = await loadCatalog();
    const variants = products.filter((p) => p.variantOf === id).map((p) => p.name);
    if (variants.length) return fail(res, `Delete or unlink its variants first: ${variants.join(', ')}`, 409);
    const doc = await LensProduct.findByIdAndDelete(id);
    if (!doc) return fail(res, 'Not found', 404);
    invalidate();
    return ok(res, { _id: id }, 'Deleted');
  } catch (e) { next(e); }
};

// ── Add-ons ─────────────────────────────────────────────────────────────────

async function readAddon(body: any, existingId?: string) {
  const company = await readCompany(body.company);
  const name = text(body.name, 'name', 60, true)!;
  const { addons } = await loadCatalog();
  if (addons.some((a) => String(a._id) !== existingId && same(a.company, company) && same(a.name, name))) {
    throw new BadInput(`${company} already has an add-on called ${name}`, 409);
  }
  const kind = body.kind === 'percent' ? 'percent' : 'fixed';
  if (!isNum(body.srp) || (kind === 'fixed' && body.srp < 0)) throw new BadInput(kind === 'fixed' ? 'price must be >= 0' : 'percent must be a number');
  const cost = body.cost === undefined || body.cost === null || body.cost === '' ? 0 : body.cost;
  if (kind === 'fixed' && !isAmount(cost)) throw new BadInput('cost must be >= 0');
  const feature = body.feature ? (LENS_FEATURES.includes(body.feature) ? body.feature : null) : null;
  if (body.feature && !feature) throw new BadInput('Unknown feature');
  return {
    company,
    name,
    kind,
    srp: body.srp,
    cost: kind === 'fixed' ? cost : 0,
    feature,
    productIds: ids(body.productIds),
    coatingIds: ids(body.coatingIds),
    excludeCoatingIds: ids(body.excludeCoatingIds),
    note: text(body.note, 'note', 200),
  };
}

export const createAddon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await LensAddon.create(await readAddon(req.body ?? {}));
    invalidate();
    return ok(res, doc, 'Add-on added', 201);
  } catch (e) { sendError(res, next, e); }
};

export const updateAddon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc: any = await LensAddon.findById(req.params.id);
    if (!doc) return fail(res, 'Not found', 404);
    const fields = await readAddon({ ...doc.toObject?.() ?? doc, ...(req.body ?? {}) }, String(doc._id));
    if (!same(fields.company, doc.company)) return fail(res, "An add-on can't move to another company", 400);
    Object.assign(doc, fields);
    await doc.save();
    invalidate();
    return ok(res, doc, 'Updated');
  } catch (e) { sendError(res, next, e); }
};

export const deleteAddon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await LensAddon.findByIdAndDelete(req.params.id);
    if (!doc) return fail(res, 'Not found', 404);
    invalidate();
    return ok(res, { _id: req.params.id }, 'Deleted');
  } catch (e) { next(e); }
};

// ── Compare ─────────────────────────────────────────────────────────────────

/**
 * POST /lens-catalog/compare
 * { rx: { right: {sph,cyl,axis,add}, left: {...} }, type, tier?, minCoatingClass?, features?, companies? }
 * → { needs, offers, hidden } — only active companies' active products.
 */
export const compare = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = req.body ?? {};
    const { coatings, products, addons, settings } = await loadCatalog();
    const { companies } = await loadLensPriceData();
    const active = new Set(companies.filter((c) => c.active !== false).map((c) => c.name.toLowerCase()));
    const result = compareLenses(
      { coatings, addons, products: products.filter((p) => active.has(p.company.toLowerCase())) },
      b.rx ?? {},
      {
        type: CATALOG_LENS_TYPES.includes(b.type) ? b.type : 'Single Vision',
        tier: PRODUCT_TIERS.includes(b.tier) ? b.tier : null,
        minCoatingClass: COATING_CLASSES.includes(b.minCoatingClass) ? b.minCoatingClass : null,
        features: features(b.features, LENS_FEATURES),
        companies: ids(b.companies),
      },
      settings,
    );
    return ok(res, result);
  } catch (e) { next(e); }
};

/**
 * POST /lens-catalog/quote
 * { company?, lensType, coating, index?, material?, photochromic?, rx } → { quote } (per pair) or { quote: null }.
 * Prices the bill's lens pickers from the catalogue (default company Local, the old price rules).
 */
export const quote = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = req.body ?? {};
    if (typeof b.lensType !== 'string' || typeof b.coating !== 'string') return fail(res, 'lensType and coating are required', 400);
    const { coatings, products, addons } = await loadCatalog();
    const index = Number(b.index);
    const result = quoteLens({ coatings, products, addons }, {
      company: typeof b.company === 'string' ? b.company : null,
      lensType: b.lensType,
      coating: b.coating,
      index: b.index != null && b.index !== '' && Number.isFinite(index) ? index : null,
      material: typeof b.material === 'string' ? b.material : null,
      photochromic: b.photochromic === true,
      rx: b.rx ?? {},
    });
    return ok(res, { quote: result });
  } catch (e) { next(e); }
};
