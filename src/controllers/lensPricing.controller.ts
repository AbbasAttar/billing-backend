import { NextFunction, Request, Response } from 'express';
import { LensPricing, LENS_TYPES, LENS_MATERIALS, LENS_COLORS, AXIS_TYPES } from '../models/LensPricing.model';
import { fail, ok } from '../utils/response';

export const getAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await LensPricing.find().sort({ lensType: 1, material: 1, coating: 1, color: 1, axisType: 1, minSph: 1, minCyl: 1 });
    return ok(res, entries);
  } catch (e) { next(e); }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lensType, material, coating, color, axisType = 'any', minSph, maxSph, minCyl, maxCyl, minAdd, maxAdd, price, costPrice = 0 } = req.body;
    if (!LENS_TYPES.includes(lensType)) return fail(res, 'Invalid lensType', 400);
    if (!LENS_MATERIALS.includes(material)) return fail(res, 'Invalid material', 400);
    if (!LENS_COLORS.includes(color)) return fail(res, 'Invalid color', 400);
    if (!AXIS_TYPES.includes(axisType)) return fail(res, 'Invalid axisType', 400);
    if (!coating?.trim()) return fail(res, 'coating is required', 400);
    if (typeof price !== 'number' || price < 0) return fail(res, 'price must be >= 0', 400);
    if (typeof costPrice !== 'number' || costPrice < 0) return fail(res, 'costPrice must be >= 0', 400);
    if (typeof minSph !== 'number') return fail(res, 'minSph must be a number', 400);
    if (typeof maxSph !== 'number') return fail(res, 'maxSph must be a number', 400);
    if (typeof minCyl !== 'number') return fail(res, 'minCyl must be a number', 400);
    if (typeof maxCyl !== 'number') return fail(res, 'maxCyl must be a number', 400);

    const entry = await LensPricing.create({
      lensType, material, coating: coating.trim(), color, axisType,
      minSph, maxSph, minCyl, maxCyl,
      minAdd: minAdd ?? null,
      maxAdd: maxAdd ?? null,
      price, costPrice,
    });
    return ok(res, entry, 'Pricing rule created', 201);
  } catch (e) { next(e); }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await LensPricing.findById(req.params.id);
    if (!entry) return fail(res, 'Not found', 404);

    const { lensType, material, coating, color, axisType, minSph, maxSph, minCyl, maxCyl, minAdd, maxAdd, price, costPrice } = req.body;

    if (lensType !== undefined) {
      if (!LENS_TYPES.includes(lensType)) return fail(res, 'Invalid lensType', 400);
      entry.lensType = lensType;
    }
    if (material !== undefined) {
      if (!LENS_MATERIALS.includes(material)) return fail(res, 'Invalid material', 400);
      entry.material = material;
    }
    if (color !== undefined) {
      if (!LENS_COLORS.includes(color)) return fail(res, 'Invalid color', 400);
      entry.color = color;
    }
    if (axisType !== undefined) {
      if (!AXIS_TYPES.includes(axisType)) return fail(res, 'Invalid axisType', 400);
      entry.axisType = axisType;
    }
    if (coating !== undefined) entry.coating = coating.trim();
    if (minSph !== undefined) entry.minSph = minSph;
    if (maxSph !== undefined) entry.maxSph = maxSph;
    if (minCyl !== undefined) entry.minCyl = minCyl;
    if (maxCyl !== undefined) entry.maxCyl = maxCyl;
    if ('minAdd' in req.body) entry.minAdd = minAdd ?? null;
    if ('maxAdd' in req.body) entry.maxAdd = maxAdd ?? null;
    if (price !== undefined) entry.price = price;
    if (costPrice !== undefined) entry.costPrice = costPrice;

    await entry.save();
    return ok(res, entry, 'Updated');
  } catch (e) { next(e); }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await LensPricing.findByIdAndDelete(req.params.id);
    if (!entry) return fail(res, 'Not found', 404);
    return ok(res, { _id: entry._id }, 'Deleted');
  } catch (e) { next(e); }
};

// GET /lens-pricing/lookup?lensType=&material=&coating=&color=&axisType=&sph=&cyl=&add=
// Priority: exact axisType match over 'any', then narrowest SPH range, then narrowest CYL range
export const lookup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lensType, material, coating, color, axisType = 'any', sph: qSph, cyl: qCyl, add: qAdd } = req.query as Record<string, string | undefined>;

    const sph = parseFloat(qSph ?? '');
    const cyl = parseFloat(qCyl ?? '');
    if (isNaN(sph)) return fail(res, 'sph must be a number', 400);
    if (isNaN(cyl)) return fail(res, 'cyl must be a number', 400);

    const hasAdd = qAdd !== undefined && qAdd !== '' && qAdd !== 'null';
    const addVal = hasAdd ? parseFloat(qAdd as string) : null;

    const baseQuery: Record<string, unknown> = {
      lensType, material, coating, color,
      axisType: { $in: [axisType, 'any'] },
      minSph: { $lte: sph },
      maxSph: { $gte: sph },
      minCyl: { $lte: cyl },
      maxCyl: { $gte: cyl },
    };

    if (addVal === null) {
      baseQuery.minAdd = null;
    } else {
      baseQuery.$and = [
        { minAdd: { $ne: null } },
        { minAdd: { $lte: addVal } },
        { $or: [{ maxAdd: null }, { maxAdd: { $gte: addVal } }] },
      ];
    }

    // Sort: exact axis match first (0) before 'any' (1), then narrowest range
    const [entry] = await LensPricing.aggregate([
      { $match: baseQuery },
      {
        $addFields: {
          _axisScore: { $cond: [{ $eq: ['$axisType', 'any'] }, 1, 0] },
          _sphRange:  { $subtract: ['$maxSph', '$minSph'] },
          _cylRange:  { $subtract: ['$maxCyl', '$minCyl'] },
        },
      },
      { $sort: { _axisScore: 1, _sphRange: 1, _cylRange: 1 } },
      { $limit: 1 },
      { $project: { _axisScore: 0, _sphRange: 0, _cylRange: 0 } },
    ]);

    return ok(res, entry ?? null);
  } catch (e) { next(e); }
};
