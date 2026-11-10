import { Request, Response, NextFunction } from 'express';
import { CutLens } from '../models/CutLens.model';
import { LENS_TYPES } from '../models/LensPricing.model';
import { ok, fail } from '../utils/response';
import { toMinusCyl } from '../utils/lensPower';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Validated fields from a create / update body. `partial` skips required checks for updates. */
function readBody(body: any, partial: boolean): { data: Record<string, unknown> } | { error: string } {
  const data: Record<string, unknown> = {};
  const has = (k: string) => body[k] !== undefined;

  if (!partial || has('lensType')) {
    if (!LENS_TYPES.includes(body.lensType)) return { error: 'Invalid lensType' };
    data.lensType = body.lensType;
  }
  for (const k of ['material', 'coating', 'color'] as const) {
    if (!partial || has(k)) {
      if (!text(body[k])) return { error: `${k} is required` };
      data[k] = text(body[k]);
    }
  }
  if (!partial || has('sph')) {
    if (num(body.sph) === null) return { error: 'sph is required' };
    data.sph = body.sph;
  }
  if (!partial || has('cyl')) data.cyl = num(body.cyl) ?? 0;
  if (!partial || has('axis')) {
    const axis = num(body.axis);
    if (axis !== null && (axis < 0 || axis > 180)) return { error: 'axis must be 0–180' };
    data.axis = axis;
  }
  if (!partial || has('add')) {
    const add = num(body.add);
    data.add = add && add > 0 ? add : null;
  }
  if (!partial || has('eye')) data.eye = body.eye === 'right' || body.eye === 'left' ? body.eye : null;
  for (const k of ['size', 'source', 'notes'] as const) if (!partial || has(k)) data[k] = text(body[k]);
  if (!partial || has('costPrice')) data.costPrice = Math.max(0, num(body.costPrice) ?? 0);
  // A lens with CYL is useless without its axis.
  const cyl = data.cyl as number | undefined;
  if (!partial && cyl && data.axis === null) return { error: 'axis is required when there is CYL' };
  return { data };
}

export const list = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const all = req.query.all === 'true';
    const rows: any[] = await CutLens.find(all ? {} : { status: 'available' }).lean();
    rows.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
    return ok(res, rows);
  } catch (e) { next(e); }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = readBody(req.body ?? {}, false);
    if ('error' in r) return fail(res, r.error, 400);
    Object.assign(r.data, toMinusCyl(r.data.sph as number, r.data.cyl as number, r.data.axis as number | null));
    const row = await CutLens.create({ ...r.data, status: 'available', usedAt: null, usedNote: '' });
    return ok(res, row, 'Cut lens added', 201);
  } catch (e) { next(e); }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = readBody(req.body ?? {}, true);
    if ('error' in r) return fail(res, r.error, 400);
    if (['sph', 'cyl', 'axis'].some((k) => k in r.data)) {
      // Keep the lens in minus cyl: work it out from the stored power plus this change.
      const current: any = await CutLens.findById(req.params.id);
      if (!current) return fail(res, 'Cut lens not found', 404);
      const merged = { sph: current.sph ?? 0, cyl: current.cyl ?? 0, axis: current.axis ?? null, ...r.data } as { sph: number; cyl: number; axis: number | null };
      Object.assign(r.data, toMinusCyl(merged.sph, merged.cyl, merged.axis));
    }
    const row = await CutLens.findByIdAndUpdate(req.params.id, r.data, { new: true });
    if (!row) return fail(res, 'Cut lens not found', 404);
    return ok(res, row);
  } catch (e) { next(e); }
};

/** Fitted again (or put back if `used: false`). Kept on record rather than deleted. */
export const markUsed = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const used = req.body?.used !== false;
    const row = await CutLens.findByIdAndUpdate(
      req.params.id,
      used ? { status: 'used', usedAt: new Date(), usedNote: text(req.body?.note) } : { status: 'available', usedAt: null, usedNote: '' },
      { new: true },
    );
    if (!row) return fail(res, 'Cut lens not found', 404);
    return ok(res, row, used ? 'Marked as used' : 'Back in stock');
  } catch (e) { next(e); }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await CutLens.findByIdAndDelete(req.params.id);
    if (!row) return fail(res, 'Cut lens not found', 404);
    return ok(res, { _id: req.params.id }, 'Cut lens deleted');
  } catch (e) { next(e); }
};
