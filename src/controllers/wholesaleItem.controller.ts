import { Request, Response, NextFunction } from 'express';
import { Fragrance } from '../models/Fragrance.model';
import { WholesaleCompany } from '../models/WholesaleCompany.model';
import { ok, fail } from '../utils/response';
import {
  fragranceUpdateFor, parseEntryKey, wholesaleEntries, entryKey, type EntryPatch, type WholesaleEntry,
} from '../services/wholesaleCatalog';

/**
 * Wholesale stock. Since the catalogue merge these endpoints work on fragrance records (see
 * services/wholesaleCatalog.ts); request and response shapes are unchanged for the wholesale screens.
 */

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const WHOLESALE_TYPES = ['attar', 'perfume', 'body spray', 'essence', 'bakhoor', 'packaging'];

/** Validated fields from a request body, in wholesale terms. `partial` skips required checks. */
function readBody(body: any, partial: boolean): { data?: EntryPatch & { companyId?: string | null; type?: string }; error?: string } {
  const data: EntryPatch & { companyId?: string | null; type?: string } = {};
  if (body.name !== undefined || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return { error: 'name is required' };
    data.name = name;
  }
  if (body.companyId !== undefined) data.companyId = typeof body.companyId === 'string' && body.companyId ? body.companyId : null;
  if (body.unit !== undefined || !partial) data.unit = (typeof body.unit === 'string' && body.unit.trim()) || 'bottle';
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
  if (body.costPrice !== undefined) {
    const v = num(body.costPrice);
    if (v !== undefined && v < 0) return { error: 'costPrice cannot be negative' };
    data.costPrice = v ?? null;
  }
  if (body.reorderLevel !== undefined) {
    const v = num(body.reorderLevel);
    if (v !== undefined && v < 0) return { error: 'reorderLevel cannot be negative' };
    data.ws = { reorderLevel: v ?? null };
  }
  if (body.notes !== undefined) data.notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (body.type !== undefined) {
    if (!WHOLESALE_TYPES.includes(body.type)) return { error: 'type is not valid' };
    data.type = body.type;
  }
  return { data };
}

/** companyName (and companyId) from the chosen wholesale company; '' / null clears it. */
async function resolveCompany(companyId: string | null | undefined): Promise<{ companyId: string | null; companyName: string } | { error: string } | null> {
  if (companyId === undefined) return null;
  if (!companyId) return { companyId: null, companyName: '' };
  const company = await WholesaleCompany.findById(String(companyId));
  if (!company) return { error: 'Company not found' };
  return { companyId: String(company._id), companyName: company.name };
}

async function allEntries(includeArchived: boolean): Promise<WholesaleEntry[]> {
  const fragrances = await Fragrance.find(includeArchived ? {} : { isArchived: false }).lean();
  return wholesaleEntries(fragrances as any);
}

/** Loads the fragrance behind an entry, applies the patch and returns the updated entry. */
async function patchEntry(key: string, patch: EntryPatch & { companyId?: string | null }, extra: Record<string, unknown> = {}) {
  const { fragranceId, optionLabel } = parseEntryKey(key);
  const f: any = await Fragrance.findById(fragranceId).lean();
  if (!f) return { status: 404 as const, error: 'Wholesale item not found' };
  const update = fragranceUpdateFor(f, optionLabel, patch);
  if ('error' in update) return { status: 404 as const, error: update.error as string };
  const saved: any = await Fragrance.findByIdAndUpdate(fragranceId, { ...update, ...extra }, { new: true });
  const entry = wholesaleEntries([saved?.toObject ? saved.toObject() : saved]).find((e) => e._id === entryKey(fragranceId, optionLabel));
  return { entry: entry ?? null };
}

export const getWholesaleItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    return ok(res, await allEntries(req.query.includeArchived === 'true'));
  } catch (e) { next(e); }
};

/** New wholesale item = a new fragrance record sold wholesale (and usable as raw material). */
export const createWholesaleItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = readBody(req.body ?? {}, false);
    if (error) return fail(res, error, 400);
    const resolved = await resolveCompany(data!.companyId);
    if (resolved && 'error' in resolved) return fail(res, resolved.error, 400);
    const company = resolved && !('error' in resolved) ? resolved : null;
    const unit = data!.unit || 'bottle';
    const created: any = await Fragrance.create({
      name: data!.name,
      companyName: company?.companyName ?? '',
      companyId: company?.companyId ?? null,
      type: data!.type ?? (/(^|\s)(cap|stick|bottle|canter|roll)/i.test(data!.name ?? '') ? 'packaging' : 'attar'),
      unit,
      channels: { retail: false, wholesale: true, rawMaterial: true },
      costPrice: data!.costPrice ?? 0,
      sellPrice: 0,
      stock: data!.stock ?? 0,
      wholesale: { price: data!.sellPrice ?? 0, unit: `per ${unit}` },
      ws: { reorderLevel: data!.ws?.reorderLevel ?? null },
      notes: data!.notes ?? '',
      variants: [],
    } as any);
    const entry = wholesaleEntries([created.toObject ? created.toObject() : created])[0];
    return ok(res, entry, 'Wholesale item created', 201);
  } catch (e) { next(e); }
};

export const updateWholesaleItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = readBody(req.body ?? {}, true);
    if (error) return fail(res, error, 400);
    const resolved = await resolveCompany(data!.companyId);
    if (resolved && 'error' in resolved) return fail(res, resolved.error, 400);
    const company = resolved && !('error' in resolved) ? resolved : null;
    const { type, companyId: _ignored, ...patch } = data!;
    const extra: Record<string, unknown> = {};
    if (type) extra.type = type;
    if (company) {
      patch.companyName = company.companyName;
      extra.companyId = company.companyId;
    }
    const r = await patchEntry(String(req.params.id), patch, extra);
    if ('error' in r) return fail(res, r.error!, r.status);
    return ok(res, r.entry);
  } catch (e) { next(e); }
};

/**
 * Order fields after `received` units of an ordered item arrive: a part delivery keeps the rest on
 * order; receiving the ordered quantity (or more, or an order with no quantity) closes it.
 */
export function orderAfterInward(orderedQty: number | null | undefined, received: number) {
  const remaining = (orderedQty ?? 0) - received;
  return remaining > 0
    ? { isOrdered: true, orderedQty: remaining }
    : { isOrdered: false, orderedQty: null, orderedAt: null };
}

/**
 * POST /:id/adjust-stock { delta, sellPrice?, costPrice?, receivedOrder? } — inward a fresh lot (+) or
 * write off breakage (−). An inward may carry the lot's new cost / selling price.
 */
export const adjustWholesaleStock = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const delta = num(req.body?.delta);
    if (delta === undefined || delta === 0) return fail(res, 'delta must be a non-zero number', 400);
    const patch: EntryPatch = { stockDelta: delta };
    for (const key of ['sellPrice', 'costPrice'] as const) {
      const v = num(req.body?.[key]);
      if (v === undefined) continue;
      if (v < 0) return fail(res, `${key} cannot be negative`, 400);
      patch[key] = v;
    }
    if (req.body?.receivedOrder === true && delta > 0) {
      const all = await allEntries(true);
      const current = all.find((e) => e._id === String(req.params.id));
      patch.ws = orderAfterInward(current?.orderedQty, delta);
    }
    const r = await patchEntry(String(req.params.id), patch);
    if ('error' in r) return fail(res, r.error!, r.status);
    return ok(res, r.entry);
  } catch (e) { next(e); }
};

/** POST /order-status { ids, ordered, quantities? } — mark entries ordered (with quantity) or back. */
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
      const ws = ordered
        ? { isOrdered: true, orderedQty: qty !== undefined && qty > 0 ? qty : null, orderedAt: now, inOrderQueue: false, queueQty: null }
        : { isOrdered: false, orderedQty: null, orderedAt: null };
      const r = await patchEntry(id, { ws });
      if ('entry' in r && r.entry) updated.push(r.entry);
    }
    return ok(res, updated);
  } catch (e) { next(e); }
};

/** POST /queue { add?, remove?, quantities? } — the order queue kept on the server. */
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
    for (const [id, ws] of patches) {
      const r = await patchEntry(id, { ws });
      if ('entry' in r && r.entry) updated.push(r.entry);
    }
    return ok(res, updated);
  } catch (e) { next(e); }
};

/**
 * PATCH /:id/archive { archive } — a plain product is archived as a whole; a grade / size stops being
 * sold wholesale (its wholesale price is removed) and comes back with a new price from the fragrance form.
 */
export const archiveWholesaleItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const archive = req.body?.archive !== false;
    const { fragranceId, optionLabel } = parseEntryKey(String(req.params.id));
    const f: any = await Fragrance.findById(fragranceId).lean();
    if (!f) return fail(res, 'Wholesale item not found', 404);
    if (optionLabel) {
      if (!archive) return fail(res, 'Give the grade / size a wholesale price again in the fragrance form', 400);
      const variants = (f.variants ?? []).map((v: any) => (v.label === optionLabel ? { ...v, wholesale: null } : v));
      await Fragrance.findByIdAndUpdate(fragranceId, { variants });
      return ok(res, { _id: String(req.params.id), isArchived: true });
    }
    const saved: any = await Fragrance.findByIdAndUpdate(fragranceId, { isArchived: archive, archivedAt: archive ? new Date() : null }, { new: true });
    return ok(res, wholesaleEntries([saved?.toObject ? saved.toObject() : saved])[0] ?? { _id: fragranceId, isArchived: archive });
  } catch (e) { next(e); }
};
