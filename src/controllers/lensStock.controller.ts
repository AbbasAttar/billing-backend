import { Request, Response, NextFunction } from 'express';
import { LensStock } from '../models/LensStock.model';
import { LENS_TYPES, LENS_MATERIALS, LENS_COLORS } from '../models/LensPricing.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { ok, fail } from '../utils/response';

// ── GET all ──────────────────────────────────────────────────────────────────

export const getAll = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lensType, material, coating, color, lowStock } = req.query as Record<string, string>;
    const filter: Record<string, unknown> = {};
    if (lensType)  filter.lensType = lensType;
    if (material)  filter.material = material;
    if (coating)   filter.coating  = coating;
    if (color)     filter.color    = color;
    if (lowStock === 'true') filter.$expr = { $lte: ['$quantity', '$reorderLevel'] };

    const stock = await LensStock.find(filter).sort({
      lensType: 1, material: 1, coating: 1, color: 1, sph: 1, cyl: 1, add: 1,
    });
    return ok(res, stock);
  } catch (e) { next(e); }
};

// ── CREATE ────────────────────────────────────────────────────────────────────

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lensType, material, coating, color, sph, cyl, add, quantity, reorderLevel, costPrice } = req.body;

    if (!LENS_TYPES.includes(lensType))     return fail(res, 'Invalid lensType', 400);
    if (!LENS_MATERIALS.includes(material)) return fail(res, 'Invalid material', 400);
    if (!LENS_COLORS.includes(color))       return fail(res, 'Invalid color', 400);
    if (!coating?.trim())                   return fail(res, 'coating is required', 400);
    if (typeof sph !== 'number')            return fail(res, 'sph is required', 400);

    const entry = await LensStock.create({
      lensType,
      material,
      coating: coating.trim(),
      color,
      sph,
      cyl:          typeof cyl === 'number'          ? cyl          : 0,
      add:          typeof add === 'number'           ? add          : null,
      quantity:     typeof quantity === 'number'      ? quantity     : 0,
      reorderLevel: typeof reorderLevel === 'number'  ? reorderLevel : 2,
      costPrice:    typeof costPrice === 'number'     ? costPrice    : 0,
    });
    return ok(res, entry, 'Stock entry created', 201);
  } catch (e: any) {
    if (e.code === 11000) return fail(res, 'A stock entry for this exact lens already exists', 409);
    next(e);
  }
};

// ── UPDATE ────────────────────────────────────────────────────────────────────

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lensType, material, coating, color, sph, cyl, add, quantity, reorderLevel, costPrice } = req.body;
    const patch: Record<string, unknown> = {};

    if (lensType  !== undefined) {
      if (!LENS_TYPES.includes(lensType)) return fail(res, 'Invalid lensType', 400);
      patch.lensType = lensType;
    }
    if (material !== undefined) {
      if (!LENS_MATERIALS.includes(material)) return fail(res, 'Invalid material', 400);
      patch.material = material;
    }
    if (color !== undefined) {
      if (!LENS_COLORS.includes(color)) return fail(res, 'Invalid color', 400);
      patch.color = color;
    }
    if (coating   !== undefined) patch.coating      = coating.trim();
    if (sph       !== undefined) patch.sph          = sph;
    if (cyl       !== undefined) patch.cyl          = cyl;
    if (add       !== undefined) patch.add          = add;
    if (quantity  !== undefined) patch.quantity     = quantity;
    if (reorderLevel !== undefined) patch.reorderLevel = reorderLevel;
    if (costPrice !== undefined) patch.costPrice    = costPrice;

    const entry = await LensStock.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
    if (!entry) return fail(res, 'Stock entry not found', 404);
    return ok(res, entry);
  } catch (e: any) {
    if (e.code === 11000) return fail(res, 'A stock entry for this exact lens already exists', 409);
    next(e);
  }
};

// ── ADJUST quantity (PATCH) ───────────────────────────────────────────────────

export const adjust = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { delta } = req.body as { delta?: number };
    if (typeof delta !== 'number') return fail(res, 'delta is required and must be a number', 400);

    const entry = await LensStock.findById(req.params.id);
    if (!entry) return fail(res, 'Stock entry not found', 404);

    const newQty = entry.quantity + delta;
    if (newQty < 0) return fail(res, 'Cannot reduce quantity below 0', 400);
    entry.quantity = newQty;
    await entry.save();
    return ok(res, entry);
  } catch (e) { next(e); }
};

// ── DELETE ────────────────────────────────────────────────────────────────────

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await LensStock.findByIdAndDelete(req.params.id);
    if (!entry) return fail(res, 'Stock entry not found', 404);
    return ok(res, { _id: entry._id }, 'Stock entry deleted');
  } catch (e) { next(e); }
};

// ── TRENDS ────────────────────────────────────────────────────────────────────

export const trends = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Top lens combos sold (merge RE + LE sold across all invoices)
    const topSold = await InvoiceItem.aggregate([
      {
        $match: {
          lensType: { $ne: null, $exists: true },
          lensMaterial: { $ne: null, $exists: true },
          rightSpherical: { $ne: null },
        },
      },
      {
        $project: {
          lensType: 1,
          material: '$lensMaterial',
          coating: '$lensCoating',
          color: '$lensColor',
          sph: '$rightSpherical',
          cyl: { $ifNull: ['$rightCylinder', 0] },
          add: '$rightAddition',
        },
      },
      {
        $unionWith: {
          coll: 'invoiceitems',
          pipeline: [
            {
              $match: {
                lensType: { $ne: null, $exists: true },
                lensMaterial: { $ne: null, $exists: true },
                leftSpherical: { $ne: null },
              },
            },
            {
              $project: {
                lensType: 1,
                material: '$lensMaterial',
                coating: '$lensCoating',
                color: '$lensColor',
                sph: '$leftSpherical',
                cyl: { $ifNull: ['$leftCylinder', 0] },
                add: '$leftAddition',
              },
            },
          ],
        },
      },
      {
        $group: {
          _id: {
            lensType: '$lensType',
            material: '$material',
            coating: '$coating',
            color: '$color',
            sph: '$sph',
            cyl: '$cyl',
            add: '$add',
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 20 },
      {
        $project: {
          _id: 0,
          lensType: '$_id.lensType',
          material: '$_id.material',
          coating: '$_id.coating',
          color: '$_id.color',
          sph: '$_id.sph',
          cyl: '$_id.cyl',
          add: '$_id.add',
          count: 1,
        },
      },
    ]);

    // Low stock alerts (quantity <= reorderLevel)
    const lowStock = await LensStock.find({
      $expr: { $lte: ['$quantity', '$reorderLevel'] },
    })
      .sort({ quantity: 1 })
      .limit(50)
      .lean();

    // Power distribution (SPH histogram across all sold lenses)
    const sphDistRaw = await InvoiceItem.aggregate([
      {
        $match: {
          lensType: { $ne: null, $exists: true },
          lensMaterial: { $ne: null, $exists: true },
        },
      },
      {
        $facet: {
          re: [
            { $match: { rightSpherical: { $ne: null } } },
            { $group: { _id: '$rightSpherical', count: { $sum: 1 } } },
          ],
          le: [
            { $match: { leftSpherical: { $ne: null } } },
            { $group: { _id: '$leftSpherical', count: { $sum: 1 } } },
          ],
        },
      },
    ]);

    const sphMap = new Map<number, number>();
    for (const { _id, count } of sphDistRaw[0].re) {
      sphMap.set(_id, (sphMap.get(_id) ?? 0) + count);
    }
    for (const { _id, count } of sphDistRaw[0].le) {
      sphMap.set(_id, (sphMap.get(_id) ?? 0) + count);
    }
    const sphDistribution = Array.from(sphMap.entries())
      .map(([sph, count]) => ({ sph, count }))
      .sort((a, b) => a.sph - b.sph);

    // Restock suggestions: top-sold combos that have low/no stock
    const restockSuggestions = await Promise.all(
      topSold.slice(0, 10).map(async (combo) => {
        const stock = await LensStock.findOne({
          lensType: combo.lensType,
          material: combo.material,
          coating: combo.coating ?? null,
          color: combo.color ?? null,
          sph: combo.sph,
          cyl: combo.cyl ?? 0,
          add: combo.add ?? null,
        }).lean();
        return {
          ...combo,
          currentStock: stock?.quantity ?? 0,
          reorderLevel: stock?.reorderLevel ?? 2,
          needsRestock: !stock || stock.quantity <= stock.reorderLevel,
        };
      })
    );

    return ok(res, {
      topSold,
      lowStock,
      sphDistribution,
      restockSuggestions: restockSuggestions.filter((r) => r.needsRestock),
    });
  } catch (e) { next(e); }
};

// ── DEDUCT stock (called internally from invoice creation) ────────────────────

export async function deductLensStock(opts: {
  lensType: string;
  material: string;
  coating: string | null;
  color: string | null;
  sph: number;
  cyl: number;
  add: number | null;
}): Promise<void> {
  if (!opts.lensType || !opts.material || !opts.coating || !opts.color) return;
  await LensStock.findOneAndUpdate(
    {
      lensType: opts.lensType,
      material: opts.material,
      coating: opts.coating,
      color: opts.color,
      sph: opts.sph,
      cyl: opts.cyl,
      add: opts.add ?? null,
      quantity: { $gt: 0 },
    },
    { $inc: { quantity: -1 } }
  );
}
