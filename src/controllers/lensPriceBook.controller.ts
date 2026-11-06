import { NextFunction, Request, Response } from 'express';
import { LensCompany, LENS_TIERS, SUPPLY_TYPES, LOCAL_COMPANY } from '../models/LensCompany.model';
import { LensPriceBook, type BookBand, type ILensPriceBook } from '../models/LensPriceBook.model';
import { LENS_TYPES, isLensName } from '../models/LensPricing.model';
import { SiteSetting } from '../models/SiteSetting.model';
import { fail, ok } from '../utils/response';
import { axisTypeFor, type MarkupPolicy, type MarkupSlab, type PriceResult } from '../services/lensPriceResolver';
import { buildResolveContext, invalidateLensPriceData, loadLensPriceData, MARKUP_KEY, mergeMarkup, resolveEye } from '../services/lensPriceData';

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

class BadInput extends Error {}

// ── Companies ───────────────────────────────────────────────────────────────

// GET /lens-pricing/companies — Local first; it is created the first time the list is read.
export const listCompanies = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let { companies } = await loadLensPriceData();
    if (!companies.some((c) => c.name === LOCAL_COMPANY)) {
      await LensCompany.create({ name: LOCAL_COMPANY, tier: 'essential', supplyType: 'wholesaler', active: true, supplier: null });
      invalidateLensPriceData();
      ({ companies } = await loadLensPriceData());
    }
    const rank = (name: string) => (name === LOCAL_COMPANY ? 0 : 1);
    return ok(res, [...companies].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)));
  } catch (e) { next(e); }
};

function readCompanyFields(body: any, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60) throw new BadInput('name is required (max 60 characters)');
    out.name = name;
  }
  if (!partial || body.tier !== undefined) {
    const tier = body.tier ?? 'essential';
    if (!LENS_TIERS.includes(tier)) throw new BadInput('Invalid tier');
    out.tier = tier;
  }
  if (!partial || body.supplyType !== undefined) {
    const supplyType = body.supplyType ?? 'wholesaler';
    if (!SUPPLY_TYPES.includes(supplyType)) throw new BadInput('Invalid supplyType');
    out.supplyType = supplyType;
    if (supplyType === 'direct') out.supplier = null;
  }
  if (body.supplier !== undefined && out.supplyType !== 'direct') out.supplier = body.supplier ? String(body.supplier).trim() : null;
  if (!partial || body.active !== undefined) out.active = body.active !== false;
  return out;
}

async function nameTaken(name: string) {
  return Boolean(await companyByName(name));
}

// POST /lens-pricing/companies
export const createCompany = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fields = readCompanyFields(req.body ?? {}, false);
    if (await nameTaken(fields.name as string)) return fail(res, 'A lens company with this name already exists', 409);
    const company = await LensCompany.create(fields as any);
    invalidateLensPriceData();
    return ok(res, company, 'Lens company created', 201);
  } catch (e) {
    if (e instanceof BadInput) return fail(res, e.message, 400);
    next(e);
  }
};

// PUT /lens-pricing/companies/:id — renaming is not allowed: rules, books and bills refer to the name.
export const updateCompany = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const company = await LensCompany.findById(req.params.id);
    if (!company) return fail(res, 'Not found', 404);
    const fields = readCompanyFields(req.body ?? {}, true);
    if (fields.name !== undefined && fields.name !== company.name) return fail(res, 'A lens company cannot be renamed', 400);
    Object.assign(company, fields);
    await company.save();
    invalidateLensPriceData();
    return ok(res, company, 'Updated');
  } catch (e) {
    if (e instanceof BadInput) return fail(res, e.message, 400);
    next(e);
  }
};

// DELETE /lens-pricing/companies/:id — keeps its book and rules; deactivate instead to hide it.
export const removeCompany = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const company = await LensCompany.findById(req.params.id);
    if (!company) return fail(res, 'Not found', 404);
    if (company.name === LOCAL_COMPANY) return fail(res, 'The Local company cannot be deleted', 400);
    await LensCompany.findByIdAndDelete(req.params.id);
    invalidateLensPriceData();
    return ok(res, { _id: company._id }, 'Deleted');
  } catch (e) { next(e); }
};

// ── Price books ─────────────────────────────────────────────────────────────

function readPart(v: any, where: string) {
  if (!isAmount(v?.cost)) throw new BadInput(`${where}: cost must be >= 0`);
  const sell = v.sell === undefined || v.sell === null || v.sell === '' ? null : v.sell;
  if (sell !== null && !isAmount(sell)) throw new BadInput(`${where}: sell must be >= 0`);
  return { cost: v.cost, sell };
}

function readBands(list: unknown, where: string): BookBand[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new BadInput(`${where} must be a list`);
  return list.map((b: any, i) => {
    if (!isNumber(b?.min) || !isNumber(b?.max)) throw new BadInput(`${where}[${i}]: min and max must be numbers`);
    return { min: Math.min(b.min, b.max), max: Math.max(b.min, b.max), ...readPart(b, `${where}[${i}]`) };
  });
}

function readBook(company: string, body: any): Omit<ILensPriceBook, '_id'> {
  const bases = (Array.isArray(body.bases) ? body.bases : []).map((b: any, i: number) => {
    if (!LENS_TYPES.includes(b?.lensType)) throw new BadInput(`bases[${i}]: invalid lensType`);
    if (!isLensName(b?.material)) throw new BadInput(`bases[${i}]: invalid material`);
    return { lensType: b.lensType, material: b.material, ...readPart(b, `bases[${i}]`) };
  });
  const coatings = (Array.isArray(body.coatings) ? body.coatings : []).map((c: any, i: number) => {
    const coating = String(c?.coating ?? '').trim();
    if (!coating) throw new BadInput(`coatings[${i}]: coating is required`);
    return { coating, ...readPart(c, `coatings[${i}]`) };
  });
  const colors = (Array.isArray(body.colors) ? body.colors : []).map((c: any, i: number) => {
    if (!isLensName(c?.color)) throw new BadInput(`colors[${i}]: invalid color`);
    return { color: c.color, ...readPart(c, `colors[${i}]`) };
  });
  return {
    company,
    bases,
    sphBands: readBands(body.sphBands, 'sphBands'),
    // CYL bands are by size; store them positive.
    cylBands: readBands(body.cylBands, 'cylBands').map((b) => {
      const [lo, hi] = [Math.abs(b.min), Math.abs(b.max)].sort((x, y) => x - y);
      return { ...b, min: lo, max: hi };
    }),
    addBands: readBands(body.addBands, 'addBands'),
    coatings,
    colors,
    crossAxis: body.crossAxis ? readPart(body.crossAxis, 'crossAxis') : null,
    effectiveDate: body.effectiveDate ? String(body.effectiveDate).trim() : null,
  };
}

async function companyByName(name: string) {
  const { companies } = await loadLensPriceData();
  return companies.find((c) => c.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}

// GET /lens-pricing/books/:company — an empty book when none is saved yet.
export const getBook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.params.company);
    const { books } = await loadLensPriceData();
    const book = books.find((b) => b.company.toLowerCase() === name.trim().toLowerCase());
    return ok(res, book ?? readBook(name.trim(), {}));
  } catch (e) { next(e); }
};

// PUT /lens-pricing/books/:company — replaces the whole book.
export const putBook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const company = await companyByName(String(req.params.company));
    if (!company) return fail(res, 'Unknown lens company — add it first', 404);
    const book = readBook(company.name, req.body ?? {});
    const saved = await LensPriceBook.findOneAndUpdate({ company: company.name }, { $set: book }, { upsert: true, new: true });
    invalidateLensPriceData();
    return ok(res, saved, 'Price book saved');
  } catch (e) {
    if (e instanceof BadInput) return fail(res, e.message, 400);
    next(e);
  }
};

// ── Markup ──────────────────────────────────────────────────────────────────

function readSlabs(list: unknown, where: string): MarkupSlab[] {
  if (!Array.isArray(list) || list.length === 0) throw new BadInput(`${where} needs at least one slab`);
  const slabs = list.map((s: any, i) => {
    if (!isNumber(s?.x) || s.x < 1) throw new BadInput(`${where}[${i}]: x must be >= 1`);
    const upTo = s.upTo === undefined || s.upTo === null || s.upTo === '' ? null : s.upTo;
    if (upTo !== null && !isAmount(upTo)) throw new BadInput(`${where}[${i}]: upTo must be >= 0`);
    return { upTo, x: s.x };
  });
  if (!slabs.some((s) => s.upTo === null)) throw new BadInput(`${where}: the last slab needs no upper limit`);
  return slabs.sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
}

// GET /lens-pricing/markup
export const getMarkup = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { markup } = await loadLensPriceData();
    return ok(res, markup);
  } catch (e) { next(e); }
};

// PUT /lens-pricing/markup
export const putMarkup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const current = mergeMarkup((await SiteSetting.findOne({ key: MARKUP_KEY }).lean() as any)?.value);
    const next_: MarkupPolicy = { ...current };
    if (body.slabs !== undefined) next_.slabs = readSlabs(body.slabs, 'slabs');
    if (body.tierSlabs !== undefined) {
      const tierSlabs: MarkupPolicy['tierSlabs'] = {};
      for (const [tier, slabs] of Object.entries(body.tierSlabs ?? {})) {
        if (!LENS_TIERS.includes(tier as any)) throw new BadInput(`Invalid tier ${tier}`);
        if (Array.isArray(slabs) && slabs.length) tierSlabs[tier as keyof typeof tierSlabs] = readSlabs(slabs, `tierSlabs.${tier}`);
      }
      next_.tierSlabs = tierSlabs;
    }
    if (body.minMarginPair !== undefined) {
      if (!isAmount(body.minMarginPair)) throw new BadInput('minMarginPair must be >= 0');
      next_.minMarginPair = body.minMarginPair;
    }
    if (body.roundTo !== undefined) {
      if (!isAmount(body.roundTo) || body.roundTo < 1) throw new BadInput('roundTo must be >= 1');
      next_.roundTo = body.roundTo;
    }
    await SiteSetting.findOneAndUpdate({ key: MARKUP_KEY }, { $set: { value: next_ } }, { upsert: true, new: true });
    invalidateLensPriceData();
    return ok(res, next_, 'Markup saved');
  } catch (e) {
    if (e instanceof BadInput) return fail(res, e.message, 400);
    next(e);
  }
};

// ── Resolve ─────────────────────────────────────────────────────────────────

const toNum = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

function eyeRx(raw: any) {
  const sph = toNum(raw?.sph) ?? 0;
  const cyl = toNum(raw?.cyl) ?? 0;
  const addVal = toNum(raw?.add);
  return { sph, cyl, add: addVal !== null && addVal > 0 ? addVal : null, axisType: axisTypeFor(cyl, toNum(raw?.axis)) };
}

/**
 * POST /lens-pricing/resolve
 * { company?, lensType, material, coating, color, eye: 'both'|'right'|'left', right: {sph,cyl,axis,add}, left: {...} }
 * Per-eye results are pair prices; `price` / `cost` are for the selected eyes (each eye is half its pair).
 */
export const resolve = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = req.body ?? {};
    const spec = {
      company: b.company ? String(b.company).trim() : LOCAL_COMPANY,
      lensType: String(b.lensType ?? ''),
      material: String(b.material ?? ''),
      coating: String(b.coating ?? '').trim(),
      color: String(b.color ?? 'White'),
    };
    if (!spec.lensType || !spec.material || !spec.coating) return fail(res, 'lensType, material and coating are required', 400);
    const eye = ['right', 'left', 'both'].includes(b.eye) ? b.eye : 'both';

    const ctx = await buildResolveContext(spec);
    const out: { right?: PriceResult; left?: PriceResult } = {};
    if (eye !== 'left') out.right = await resolveEye(spec, eyeRx(b.right), ctx);
    if (eye !== 'right') out.left = await resolveEye(spec, eyeRx(b.left), ctx);

    const results = [out.right, out.left].filter((r): r is PriceResult => Boolean(r));
    const missing = results.some((r) => r.source === 'missing');
    const costKnown = results.every((r) => r.cost !== null);
    return ok(res, {
      ...out,
      price: results.reduce((s, r) => s + (r.sell ?? 0) / 2, 0),
      cost: costKnown ? results.reduce((s, r) => s + (r.cost as number) / 2, 0) : null,
      missing,
      marginOk: results.some((r) => r.marginOk === false) ? false : results.every((r) => r.marginOk === true) ? true : null,
    });
  } catch (e) { next(e); }
};
