import { Request, Response, NextFunction } from 'express';
import { WholesaleItem } from '../models/WholesaleItem.model';
import { WholesaleCompany } from '../models/WholesaleCompany.model';
import { ok, fail } from '../utils/response';

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Validated create/update fields from a request body. `partial` skips required checks. */
function readBody(body: any, partial: boolean): { data?: Record<string, unknown>; error?: string } {
  const data: Record<string, unknown> = {};

  if (body.name !== undefined || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: 'name is required' };
    data.name = name;
  }
  if (body.companyId !== undefined) data.companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (body.unit !== undefined || !partial) {
    data.unit = (typeof body.unit === 'string' && body.unit.trim()) || 'bottle';
  }
  if (body.sellPrice !== undefined || !partial) {
    const sellPrice = num(body.sellPrice);
    if (sellPrice === undefined || sellPrice < 0) return { error: 'sellPrice must be a non-negative number' };
    data.sellPrice = sellPrice;
  }
  if (body.stock !== undefined || !partial) {
    const stock = num(body.stock) ?? 0;
    if (stock < 0) return { error: 'stock cannot be negative' };
    data.stock = stock;
  }
  for (const key of ['costPrice', 'reorderLevel'] as const) {
    if (body[key] === undefined) continue;
    const v = num(body[key]);
    if (v !== undefined && v < 0) return { error: `${key} cannot be negative` };
    data[key] = v ?? null;
  }
  if (body.notes !== undefined) data.notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  return { data };
}

/** Fills companyName from the chosen company (companyId '' clears it). Returns an error message. */
async function resolveCompany(data: Record<string, unknown>): Promise<string | null> {
  if (data.companyId === undefined) return null;
  if (!data.companyId) {
    data.companyId = null;
    data.companyName = '';
    return null;
  }
  const company = await WholesaleCompany.findById(String(data.companyId));
  if (!company) return 'Company not found';
  data.companyName = company.name;
  return null;
}

export const getWholesaleItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const items = await WholesaleItem.find(includeArchived ? {} : { isArchived: false });
    // Sorted here: a Firestore orderBy would drop older docs that have no companyName.
    items.sort((a: any, b: any) =>
      (a.companyName || '').localeCompare(b.companyName || '') || (a.name || '').localeCompare(b.name || ''));
    return ok(res, items);
  } catch (e) { next(e); }
};

export const createWholesaleItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = readBody(req.body ?? {}, false);
    if (error) return fail(res, error, 400);
    const companyError = await resolveCompany(data!);
    if (companyError) return fail(res, companyError, 400);
    const item = await WholesaleItem.create(data as any);
    return ok(res, item, 'Wholesale item created', 201);
  } catch (e) { next(e); }
};

export const updateWholesaleItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = readBody(req.body ?? {}, true);
    if (error) return fail(res, error, 400);
    const companyError = await resolveCompany(data!);
    if (companyError) return fail(res, companyError, 400);
    const item = await WholesaleItem.findByIdAndUpdate(req.params.id, data, { new: true });
    if (!item) return fail(res, 'Wholesale item not found', 404);
    return ok(res, item);
  } catch (e) { next(e); }
};

/**
 * POST /:id/adjust-stock { delta, sellPrice?, costPrice? } — inward a fresh lot (+) or write off
 * breakage (−). An inward may carry the lot's new cost / selling price, which replace the old ones.
 */
export const adjustWholesaleStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const delta = num(req.body?.delta);
    if (delta === undefined || delta === 0) return fail(res, 'delta must be a non-zero number', 400);
    const update: Record<string, number> = {};
    for (const key of ['sellPrice', 'costPrice'] as const) {
      const v = num(req.body?.[key]);
      if (v === undefined) continue;
      if (v < 0) return fail(res, `${key} cannot be negative`, 400);
      update[key] = v;
    }
    const existing = await WholesaleItem.findById(req.params.id);
    if (!existing) return fail(res, 'Wholesale item not found', 404);
    const patch: Record<string, unknown> = { ...update, stock: Math.max(0, (existing.stock || 0) + delta) };
    // An inward of an ordered item means the order arrived.
    if (req.body?.receivedOrder === true && delta > 0) Object.assign(patch, { isOrdered: false, orderedQty: null, orderedAt: null });
    const item = await WholesaleItem.findByIdAndUpdate(req.params.id, patch, { new: true });
    return ok(res, item);
  } catch (e) { next(e); }
};

/**
 * POST /order-status { ids, ordered, quantities? } — bulk mark items ordered (with the quantity sent
 * to the wholesaler) or back to not ordered.
 */
export const setWholesaleOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ids: unknown = req.body?.ids;
    const ordered = req.body?.ordered === true;
    const quantities: Record<string, unknown> = req.body?.quantities ?? {};
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
      return fail(res, 'ids must be a non-empty list', 400);
    }
    if (ids.length > 200) return fail(res, 'Too many items at once (max 200)', 400);
    const now = new Date();
    const updated = [];
    for (const id of ids as string[]) {
      const qty = num(quantities[id]);
      // Ordering takes the item out of the order queue.
      const patch = ordered
        ? { isOrdered: true, orderedQty: qty !== undefined && qty > 0 ? qty : null, orderedAt: now, inOrderQueue: false, queueQty: null }
        : { isOrdered: false, orderedQty: null, orderedAt: null };
      const item = await WholesaleItem.findByIdAndUpdate(id, patch, { new: true });
      if (item) updated.push(item);
    }
    return ok(res, updated);
  } catch (e) { next(e); }
};

/**
 * POST /queue { add?, remove?, quantities? } — the order queue kept on the server so it survives a
 * refresh: add items, remove items, or save the quantity typed for queued items (null clears it).
 */
export const updateOrderQueue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = (v: unknown): string[] | null =>
      v === undefined ? [] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
    const add = list(req.body?.add);
    const remove = list(req.body?.remove);
    const quantities: Record<string, unknown> = req.body?.quantities ?? {};
    if (!add || !remove || typeof quantities !== 'object') return fail(res, 'add / remove must be lists of ids', 400);
    if (add.length + remove.length + Object.keys(quantities).length > 300) return fail(res, 'Too many changes at once', 400);

    const patches = new Map<string, Record<string, unknown>>();
    const patchFor = (id: string) => patches.get(id) ?? patches.set(id, {}).get(id)!;
    for (const id of add) patchFor(id).inOrderQueue = true;
    for (const [id, raw] of Object.entries(quantities)) {
      const qty = num(raw);
      if (qty !== undefined && qty < 0) return fail(res, 'quantity cannot be negative', 400);
      patchFor(id).queueQty = qty && qty > 0 ? qty : null;
    }
    for (const id of remove) Object.assign(patchFor(id), { inOrderQueue: false, queueQty: null });

    const updated = [];
    for (const [id, patch] of patches) {
      const item = await WholesaleItem.findByIdAndUpdate(id, patch, { new: true });
      if (item) updated.push(item);
    }
    return ok(res, updated);
  } catch (e) { next(e); }
};

export const archiveWholesaleItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const archive = req.body?.archive !== false;
    const item = await WholesaleItem.findByIdAndUpdate(
      req.params.id,
      { isArchived: archive, archivedAt: archive ? new Date() : null },
      { new: true },
    );
    if (!item) return fail(res, 'Wholesale item not found', 404);
    return ok(res, item);
  } catch (e) { next(e); }
};
