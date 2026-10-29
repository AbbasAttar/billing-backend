/**
 * Refilling a fragrance: add stock to one grade / size (or the plain product), taken from the shop's
 * own wholesale stock (which goes down by what was used) or bought outside. When the cost is known the
 * cost price becomes the stock-weighted average of the old stock and the refill.
 */
import { stockUnitOf } from './wholesaleCatalog';
import type { BaseDoc } from '../lib/firestoreModel';
import type { IFragranceRefill } from '../models/FragranceRefill.model';

export interface RefillInput {
  optionLabel?: string;
  qty: number;
  source: 'wholesale' | 'outside';
  fromFragranceId?: string;
  fromOptionLabel?: string;
  /** Taken off the wholesale product, in its unit; defaults to `qty`. */
  fromQty?: number;
  /** What the refill cost in all. Wholesale: defaults to the wholesale product's cost × quantity taken. */
  totalCost?: number;
  supplier?: string;
  note?: string;
}

type RefillRecord = Omit<IFragranceRefill, keyof BaseDoc | 'createdAt' | 'updatedAt'>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const numOrUndef = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const textOrUndef = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Body of POST /fragrances/:id/refill as a RefillInput, or an error message. */
export function parseRefillInput(body: any): RefillInput | { error: string } {
  const qty = numOrUndef(body?.qty);
  if (qty === undefined || !Number.isFinite(qty) || qty <= 0) return { error: 'Quantity must be more than 0' };
  const source = body?.source;
  if (source !== 'wholesale' && source !== 'outside') return { error: 'Say where the refill came from' };
  const fromQty = numOrUndef(body?.fromQty);
  if (fromQty !== undefined && !(Number.isFinite(fromQty) && fromQty > 0)) return { error: 'Quantity taken must be more than 0' };
  const totalCost = numOrUndef(body?.totalCost);
  if (totalCost !== undefined && !(Number.isFinite(totalCost) && totalCost >= 0)) return { error: 'Cost cannot be negative' };
  const fromFragranceId = textOrUndef(body?.fromFragranceId);
  if (source === 'wholesale' && !fromFragranceId) return { error: 'Choose the wholesale product it was filled from' };
  return {
    qty, source, fromQty, totalCost, fromFragranceId: source === 'wholesale' ? fromFragranceId : undefined,
    optionLabel: textOrUndef(body?.optionLabel),
    fromOptionLabel: source === 'wholesale' ? textOrUndef(body?.fromOptionLabel) : undefined,
    supplier: source === 'outside' ? textOrUndef(body?.supplier) : undefined,
    note: textOrUndef(body?.note),
  };
}

/** Stock and cost of one option (or the plain product) of a fragrance doc, with a setter on a copy. */
function slot(doc: any, label: string | undefined, variants: any[] | undefined) {
  if (doc.variants?.length) {
    const idx = (variants ?? []).findIndex((v: any) => v.label === label);
    if (idx < 0) return null;
    return { stock: variants![idx].stock || 0, cost: variants![idx].costPrice ?? doc.costPrice ?? 0, idx };
  }
  return { stock: doc.stock || 0, cost: doc.costPrice ?? 0, idx: -1 };
}

/**
 * Works out the refill: the fragrance updates to write (target, and the wholesale product when stock
 * is taken from it — possibly the same doc) and the history record. Reads nothing.
 */
export function planRefill(
  targetId: string,
  docs: Map<string, any>,
  input: RefillInput,
): { updates: Map<string, Record<string, any>>; record: RefillRecord } | { error: string } {
  const target = docs.get(targetId);
  if (!target) return { error: 'Fragrance not found' };
  if (target.variants?.length && !input.optionLabel) return { error: 'Choose the grade / size you refilled' };

  // Each doc's variants are copied once, so a refill from another option of the same product works.
  const variantsOf = new Map<string, any[]>();
  const copyVariants = (id: string) => {
    if (!variantsOf.has(id)) variantsOf.set(id, (docs.get(id)?.variants ?? []).map((v: any) => ({ ...v })));
    return variantsOf.get(id)!;
  };
  const updates = new Map<string, Record<string, any>>();
  const updateOf = (id: string) => updates.get(id) ?? (updates.set(id, {}), updates.get(id)!);

  let totalCost = input.totalCost;
  let from: { name: string; unit: string; qty: number; shortBy: number } | null = null;

  if (input.source === 'wholesale') {
    const src = docs.get(input.fromFragranceId!);
    if (!src) return { error: 'Wholesale product not found' };
    if (src.variants?.length && !input.fromOptionLabel) return { error: `Choose which grade / size of ${src.name} was used` };
    if (input.fromFragranceId === targetId && (input.fromOptionLabel ?? '') === (input.optionLabel ?? '')) {
      return { error: 'A product cannot be refilled from itself' };
    }
    const srcVariants = src.variants?.length ? copyVariants(input.fromFragranceId!) : undefined;
    const s = slot(src, input.fromOptionLabel, srcVariants);
    if (!s) return { error: `${src.name} has no grade / size "${input.fromOptionLabel}"` };
    const take = input.fromQty ?? input.qty;
    const after = Math.max(0, round2(s.stock - take));
    if (s.idx >= 0) {
      srcVariants![s.idx].stock = after;
      Object.assign(updateOf(input.fromFragranceId!), { variants: srcVariants, stock: round2(srcVariants!.reduce((n, v) => n + (v.stock || 0), 0)) });
    } else {
      updateOf(input.fromFragranceId!).stock = after;
    }
    if (totalCost === undefined && s.cost > 0) totalCost = round2(s.cost * take);
    from = { name: src.name, unit: stockUnitOf(src), qty: take, shortBy: Math.max(0, round2(take - s.stock)) };
  }

  const targetVariants = target.variants?.length ? copyVariants(targetId) : undefined;
  const t = slot(target, input.optionLabel, targetVariants);
  if (!t) return { error: `${target.name} has no grade / size "${input.optionLabel}"` };
  const stockBefore = Math.max(0, t.stock);
  const stockAfter = round2(stockBefore + input.qty);
  const costPerUnit = totalCost === undefined ? undefined : round2(totalCost / input.qty);
  const costAfter = costPerUnit === undefined
    ? t.cost
    : t.cost > 0 && stockBefore > 0 ? round2((stockBefore * t.cost + totalCost!) / stockAfter) : costPerUnit;

  if (t.idx >= 0) {
    targetVariants![t.idx].stock = stockAfter;
    if (costPerUnit !== undefined) targetVariants![t.idx].costPrice = costAfter;
    Object.assign(updateOf(targetId), { variants: targetVariants, stock: round2(targetVariants!.reduce((n, v) => n + (v.stock || 0), 0)) });
  } else {
    Object.assign(updateOf(targetId), { stock: stockAfter, ...(costPerUnit !== undefined ? { costPrice: costAfter } : {}) });
  }

  return {
    updates,
    record: {
      fragranceId: targetId,
      fragranceName: target.name,
      optionLabel: input.optionLabel ?? null,
      qty: input.qty,
      unit: stockUnitOf(target),
      source: input.source,
      fromFragranceId: input.fromFragranceId ?? null,
      fromName: from?.name ?? null,
      fromOptionLabel: input.fromOptionLabel ?? null,
      fromQty: from?.qty ?? null,
      fromUnit: from?.unit ?? null,
      shortBy: from?.shortBy || null,
      supplier: input.supplier ?? null,
      totalCost: totalCost ?? null,
      costPerUnit: costPerUnit ?? null,
      stockBefore,
      stockAfter,
      costBefore: t.cost || null,
      costAfter: costAfter || null,
      note: input.note ?? null,
    },
  };
}
