import { Request, Response, NextFunction } from 'express';
import { toMinusCyl } from '../utils/lensPower';
import { LensStock } from '../models/LensStock.model';
import { LENS_TYPES, isLensName } from '../models/LensPricing.model';
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

// ── Same lens + power ─────────────────────────────────────────────────────────

/** ADD as stored for matching: single vision (and missing / 0 ADD) is null. */
const normAdd = (add: unknown): number | null => (typeof add === 'number' && add > 0 ? Math.round(add * 100) / 100 : null);
const num2 = (n: unknown) => Math.round((typeof n === 'number' ? n : 0) * 100) / 100;

/** Axis as stored: 0–180 with a CYL, otherwise null. Undefined input = not given. */
const readAxis = (axis: unknown, cyl: unknown): number | null =>
  num2(cyl) !== 0 && typeof axis === 'number' && axis >= 0 && axis <= 180 ? Math.round(axis) : null;

/** Key for "the same physical lens": kind + power (+ axis with a CYL on bifocal / progressive; an uncut single-vision blank turns to any axis). Firestore has no unique index, so this is checked in code. */
export function stockKey(r: { lensType?: unknown; material?: unknown; coating?: unknown; color?: unknown; sph?: unknown; cyl?: unknown; axis?: unknown; add?: unknown }): string {
  const t = (v: unknown) => String(v ?? '').trim().toLowerCase();
  // Plus-cyl and minus-cyl spellings of one power are the same lens.
  const p = toMinusCyl(num2(r.sph), num2(r.cyl), typeof r.axis === 'number' ? r.axis : null);
  return [t(r.lensType), t(r.material), t(r.coating), t(r.color), p.sph, p.cyl, (t(r.lensType) === 'single vision' ? null : readAxis(p.axis, p.cyl)) ?? '', normAdd(r.add) ?? ''].join('|');
}

/** Another row for the same lens + power, if one exists (ignoring `exceptId`). */
async function findSameLens(row: Parameters<typeof stockKey>[0], exceptId?: string) {
  const key = stockKey(row);
  // Not narrowed by SPH: an older plus-cyl row has a different SPH for the same lens.
  const candidates = await LensStock.find({ lensType: row.lensType });
  return candidates.find((c: any) => String(c._id ?? c.id) !== exceptId && stockKey(c) === key) ?? null;
}

const DUPLICATE_MSG = 'A stock entry for this exact lens already exists';

/** Which eye the spare lens of a half pair is for (progressive). Anything else = not recorded. */
const readOddEye = (v: unknown): 'right' | 'left' | null => (v === 'right' || v === 'left' ? v : null);

// ── CREATE ────────────────────────────────────────────────────────────────────

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lensType, material, coating, color, sph, cyl, axis, add, quantity, reorderLevel, costPrice, oddEye } = req.body;

    if (!LENS_TYPES.includes(lensType))     return fail(res, 'Invalid lensType', 400);
    if (axis !== undefined && axis !== null && (typeof axis !== 'number' || axis < 0 || axis > 180)) return fail(res, 'axis must be 0–180', 400);
    if (!isLensName(material)) return fail(res, 'Invalid material', 400);
    if (!isLensName(color))       return fail(res, 'Invalid color', 400);
    if (!coating?.trim())                   return fail(res, 'coating is required', 400);
    if (typeof sph !== 'number')            return fail(res, 'sph is required', 400);

    // Always stored in minus cyl: 0 / +0.50 × 90 is saved as +0.50 / -0.50 × 180.
    const power = toMinusCyl(sph, typeof cyl === 'number' ? cyl : 0, typeof axis === 'number' ? axis : null);
    const doc = {
      lensType,
      material,
      coating: coating.trim(),
      color,
      sph:          power.sph,
      cyl:          power.cyl,
      axis:         readAxis(power.axis, power.cyl),
      add:          lensType === 'Single Vision' ? null : normAdd(add),
    };
    if (await findSameLens(doc)) return fail(res, DUPLICATE_MSG, 409);

    const entry = await LensStock.create({
      ...doc,
      quantity:     typeof quantity === 'number'      ? quantity     : 0,
      reorderLevel: typeof reorderLevel === 'number'  ? reorderLevel : 2,
      costPrice:    typeof costPrice === 'number'     ? costPrice    : 0,
      oddEye:       readOddEye(oddEye),
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
    const { lensType, material, coating, color, sph, cyl, axis, add, quantity, reorderLevel, costPrice, oddEye } = req.body;
    const patch: Record<string, unknown> = {};
    if (axis !== undefined && axis !== null && (typeof axis !== 'number' || axis < 0 || axis > 180)) return fail(res, 'axis must be 0–180', 400);
    if (oddEye !== undefined) patch.oddEye = readOddEye(oddEye);

    if (lensType  !== undefined) {
      if (!LENS_TYPES.includes(lensType)) return fail(res, 'Invalid lensType', 400);
      patch.lensType = lensType;
    }
    if (material !== undefined) {
      if (!isLensName(material)) return fail(res, 'Invalid material', 400);
      patch.material = material;
    }
    if (color !== undefined) {
      if (!isLensName(color)) return fail(res, 'Invalid color', 400);
      patch.color = color;
    }
    if (coating   !== undefined) patch.coating      = coating.trim();
    if (sph       !== undefined) patch.sph          = sph;
    if (cyl       !== undefined) patch.cyl          = cyl;
    if (add       !== undefined) patch.add          = normAdd(add);
    if (quantity  !== undefined) patch.quantity     = quantity;
    if (reorderLevel !== undefined) patch.reorderLevel = reorderLevel;
    if (costPrice !== undefined) patch.costPrice    = costPrice;

    const current = await LensStock.findById(req.params.id);
    if (!current) return fail(res, 'Stock entry not found', 404);
    const next = { ...(typeof (current as any).toObject === 'function' ? (current as any).toObject() : current), ...patch };
    if (next.lensType === 'Single Vision') patch.add = null;
    if (axis !== undefined || cyl !== undefined) patch.axis = readAxis(axis !== undefined ? axis : next.axis, next.cyl);
    if (sph !== undefined || cyl !== undefined || axis !== undefined) {
      // Keep the row in minus cyl.
      const p = toMinusCyl(Number(next.sph) || 0, Number(next.cyl) || 0, (patch.axis ?? next.axis ?? null) as number | null);
      patch.sph = p.sph;
      patch.cyl = p.cyl;
      patch.axis = readAxis(p.axis, p.cyl);
    }
    if (await findSameLens({ ...next, ...patch }, String(req.params.id))) {
      return fail(res, DUPLICATE_MSG, 409);
    }

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

    // Old upsert-bug rows keep their count under a literal "$inc" field; changing them here would be
    // double-counted when repairLensStockOperators.ts folds that field in.
    if (['$inc', '$set', '$setOnInsert'].some((k) => k in (entry as any))) {
      return fail(res, 'This row needs the lens stock repair script before its count can change', 409);
    }
    const newQty = (Number.isFinite(entry.quantity) ? entry.quantity : 0) + delta;
    if (newQty < 0) return fail(res, 'Cannot reduce quantity below 0', 400);
    entry.quantity = newQty;
    // A full pair again: no spare lens, so which eye it was no longer applies.
    if (newQty % 2 === 0 && (entry as any).oddEye) (entry as any).oddEye = null;
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

// ── MERGE DUPLICATES (admin) ─────────────────────────────────────────────────

/**
 * Rows for the same lens + power are folded into the oldest one: quantities summed, the highest reorder
 * level kept, the cost taken from the most recently updated row that has one. The extra rows are deleted.
 */
export const mergeDuplicates = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const all: any[] = await LensStock.find({});
    const groups = new Map<string, any[]>();
    for (const r of all) groups.set(stockKey(r), [...(groups.get(stockKey(r)) ?? []), r]);

    let merged = 0;
    let removed = 0;
    let skipped = 0;
    // Rows from the old upsert bug hold their count under literal "$inc"/"$set" fields; folding them here
    // would lose that stock. Leave those groups until repairLensStockOperators.ts has been run.
    const broken = (r: any) => ['$inc', '$set', '$setOnInsert'].some((k) => r && typeof r === 'object' && k in r);
    const time = (d: unknown) => (d ? new Date(d as string).getTime() : 0);
    for (const rows of groups.values()) {
      if (rows.length < 2) continue;
      if (rows.some(broken)) { skipped++; continue; }
      rows.sort((a, b) => time(a.createdAt) - time(b.createdAt));
      const [keep, ...extra] = rows;
      const latestCost = [...rows].sort((a, b) => time(b.updatedAt) - time(a.updatedAt)).find((r) => (r.costPrice ?? 0) > 0);
      const update: Record<string, number> = {
        reorderLevel: Math.max(...rows.map((r) => r.reorderLevel ?? 0)),
        costPrice: latestCost?.costPrice ?? keep.costPrice ?? 0,
      };
      // Leave quantity unset when none of the rows was ever counted, so it stays "not counted".
      if (rows.some((r) => Number.isFinite(r.quantity))) {
        update.quantity = rows.reduce((s, r) => s + (Number.isFinite(r.quantity) ? Math.max(0, r.quantity) : 0), 0);
      }
      await LensStock.findByIdAndUpdate(String(keep._id ?? keep.id), update);
      for (const r of extra) {
        await LensStock.findByIdAndDelete(String(r._id ?? r.id));
        removed++;
      }
      merged++;
    }
    return ok(res, { merged, removed, skipped }, merged ? `Merged ${merged} lenses, removed ${removed} duplicate rows` : 'No duplicates merged');
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

// ── SOLD NUMBERS ─────────────────────────────────────────────────────────────

export const sold = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 90, 730);
    const from = new Date();
    from.setDate(from.getDate() - days);

    const baseMatch: Record<string, any> = {
      createdAt: { $gte: from },
      lensType: { $exists: true, $ne: null },
      lensMaterial: { $exists: true, $ne: null },
    };

    // Project right-eye rows
    const reProject = {
      sph:      '$rightSpherical',
      cyl:      { $ifNull: ['$rightCylinder', 0] },
      add:      { $ifNull: ['$rightAddition', null] },
      lensType: '$lensType',
      material: '$lensMaterial',
      coating:  '$lensCoating',
      price:    '$price',
      quantity: '$quantity',
    };

    // Project left-eye rows
    const leProject = {
      sph:      '$leftSpherical',
      cyl:      { $ifNull: ['$leftCylinder', 0] },
      add:      { $ifNull: ['$leftAddition', null] },
      lensType: '$lensType',
      material: '$lensMaterial',
      coating:  '$lensCoating',
      price:    '$price',
      quantity: '$quantity',
    };

    const records = await InvoiceItem.aggregate([
      { $match: { ...baseMatch, rightSpherical: { $ne: null } } },
      { $project: reProject },
      {
        $unionWith: {
          coll: 'invoiceitems',
          pipeline: [
            { $match: { ...baseMatch, leftSpherical: { $ne: null } } },
            { $project: leProject },
          ],
        },
      },
      {
        $group: {
          _id:          { sph: '$sph', cyl: '$cyl', add: '$add', lensType: '$lensType', material: '$material' },
          timesSold:    { $sum: '$quantity' },
          avgPrice:     { $avg: '$price' },
          minPrice:     { $min: '$price' },
          maxPrice:     { $max: '$price' },
          totalRevenue: { $sum: { $multiply: ['$price', '$quantity'] } },
        },
      },
      { $sort: { timesSold: -1 } },
      { $limit: 500 },
      {
        $project: {
          _id:          0,
          sph:          '$_id.sph',
          cyl:          '$_id.cyl',
          add:          '$_id.add',
          lensType:     '$_id.lensType',
          material:     '$_id.material',
          timesSold:    1,
          avgPrice:     { $round: ['$avgPrice', 0] },
          minPrice:     1,
          maxPrice:     1,
          totalRevenue: { $round: ['$totalRevenue', 0] },
        },
      },
    ]);

    return ok(res, { days, from, records });
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
