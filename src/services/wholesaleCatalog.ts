/**
 * The wholesale list is a view of the fragrance catalogue: every product (or grade / size) that has a
 * wholesale price. Each entry has the same shape the wholesale screens always used, so Wholesale
 * Stock, Orders, Receive and the bill's Wholesale tab keep working; changes are written back to the
 * fragrance record (its own fields for a plain product, the option for a grade / size).
 *
 * Entry id: the fragrance id for a plain product, "<fragranceId>~<option label>" for an option.
 */
import type { IFragrance, IFragranceVariant, IWholesaleState } from '../models/Fragrance.model';

export const KEY_SEPARATOR = '~';

export const entryKey = (fragranceId: string, optionLabel?: string | null) =>
  optionLabel ? `${fragranceId}${KEY_SEPARATOR}${optionLabel}` : fragranceId;

export function parseEntryKey(key: string): { fragranceId: string; optionLabel: string | null } {
  const i = key.indexOf(KEY_SEPARATOR);
  return i < 0 ? { fragranceId: key, optionLabel: null } : { fragranceId: key.slice(0, i), optionLabel: key.slice(i + 1) };
}

const TYPE_UNIT: Record<string, string> = { attar: 'tola', perfume: 'bottle', 'body spray': 'bottle', essence: 'bottle', bakhoor: 'pack', packaging: 'piece' };
/** Unit stock is counted in. */
export const stockUnitOf = (f: Pick<IFragrance, 'unit' | 'type'>) => f.unit || TYPE_UNIT[f.type] || 'unit';

/** "per 100ml" → "100ml"; the wholesale screens show "bottle", "100ml"… */
const bareUnit = (u?: string) => (u ?? '').replace(/^per\s+/i, '').trim() || 'unit';

/**
 * How many stock units one wholesale unit takes. Same unit = 1; "100ml" of an attar counted in tolas
 * (12 ml) = 100 / 12; loose attar sold by weight ("25g") counts 10 g to the tola. Unknown pairs count 1 : 1.
 */
export function stockPerWholesaleUnit(wholesaleUnit: string | undefined, stockUnit: string): number {
  const w = bareUnit(wholesaleUnit).toLowerCase();
  const s = stockUnit.toLowerCase();
  if (w === s) return 1;
  const ml = /^(\d+(?:\.\d+)?)\s*ml$/.exec(w);
  if (ml && s === 'tola') return Number(ml[1]) / 12;
  const g = /^(\d+(?:\.\d+)?)\s*(?:g|gm|gms|gram|grams)$/.exec(w);
  if (g && s === 'tola') return Number(g[1]) / 10;
  if (w === 'tola' && s === 'ml') return 12;
  return 1;
}

export interface WholesaleEntry {
  _id: string;
  fragranceId: string;
  optionLabel: string | null;
  name: string;
  companyName: string;
  /** Wholesale company id (the page's company filter matches on it). */
  companyId: string | null;
  type: string;
  unit: string;
  costPrice: number | null;
  sellPrice: number;
  /** Stock in wholesale units (stock units ÷ the conversion). */
  stock: number;
  reorderLevel: number | null;
  notes?: string;
  inOrderQueue: boolean;
  queueQty: number | null;
  isOrdered: boolean;
  orderedQty: number | null;
  orderedAt: Date | null;
  isArchived: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function entryFrom(f: IFragrance & { _id: unknown }, v: IFragranceVariant | null): WholesaleEntry | null {
  const offer = v ? v.wholesale : f.wholesale;
  if (!offer || !(offer.price >= 0)) return null;
  const ws: IWholesaleState = (v ? v.ws : f.ws) ?? {};
  const per = stockPerWholesaleUnit(offer.unit, stockUnitOf(f));
  const stock = v ? v.stock ?? 0 : f.stock ?? 0;
  const cost = v ? v.costPrice ?? f.costPrice : f.costPrice;
  const id = String(f._id);
  return {
    _id: entryKey(id, v?.label),
    fragranceId: id,
    optionLabel: v?.label ?? null,
    name: v ? `${f.name} · ${v.label}` : f.name,
    companyName: f.companyName ?? '',
    companyId: f.companyId ?? null,
    type: f.type,
    unit: bareUnit(offer.unit),
    costPrice: cost && cost > 0 ? round2(cost * per) : null,
    sellPrice: offer.price,
    stock: round2(stock / per),
    reorderLevel: ws.reorderLevel ?? null,
    notes: f.notes,
    inOrderQueue: !!ws.inOrderQueue,
    queueQty: ws.queueQty ?? null,
    isOrdered: !!ws.isOrdered,
    orderedQty: ws.orderedQty ?? null,
    orderedAt: ws.orderedAt ?? null,
    isArchived: !!f.isArchived,
    createdAt: (f as any).createdAt,
    updatedAt: (f as any).updatedAt,
  };
}

/** Every wholesale entry in a set of fragrance records. */
export function wholesaleEntries(fragrances: (IFragrance & { _id: unknown })[]): WholesaleEntry[] {
  const out: WholesaleEntry[] = [];
  for (const f of fragrances) {
    if (f.variants?.length) {
      for (const v of f.variants) {
        const e = entryFrom(f, v);
        if (e) out.push(e);
      }
    } else {
      const e = entryFrom(f, null);
      if (e) out.push(e);
    }
  }
  return out.sort((a, b) => a.companyName.localeCompare(b.companyName) || a.name.localeCompare(b.name));
}

/** A change to one entry, in the wholesale screens' terms. */
export interface EntryPatch {
  name?: string;
  companyName?: string;
  unit?: string;
  costPrice?: number | null;
  sellPrice?: number;
  stock?: number;
  /** Added to stock (wholesale units); negative takes out. */
  stockDelta?: number;
  notes?: string;
  ws?: Partial<IWholesaleState>;
}

/**
 * The fragrance fields to write for a patch on one entry. Stock and cost are converted from
 * wholesale units back to stock units.
 */
export function fragranceUpdateFor(f: IFragrance, optionLabel: string | null, p: EntryPatch): Record<string, unknown> | { error: string } {
  const update: Record<string, unknown> = {};
  if (p.name !== undefined && !optionLabel) update.name = p.name;
  if (p.companyName !== undefined) update.companyName = p.companyName;
  if (p.notes !== undefined) update.notes = p.notes;
  if (optionLabel) {
    const idx = (f.variants ?? []).findIndex((v) => v.label === optionLabel);
    if (idx < 0) return { error: 'Grade / size not found' };
    const variants = f.variants.map((v) => ({ ...v }));
    const v = variants[idx];
    const per = stockPerWholesaleUnit(p.unit !== undefined ? `per ${p.unit}` : v.wholesale?.unit, stockUnitOf(f));
    if (p.sellPrice !== undefined || p.unit !== undefined) {
      v.wholesale = { ...(v.wholesale ?? { price: 0, unit: 'per bottle' }), ...(p.sellPrice !== undefined ? { price: p.sellPrice } : {}), ...(p.unit !== undefined ? { unit: `per ${p.unit}` } : {}) };
    }
    if (p.costPrice !== undefined) v.costPrice = p.costPrice === null ? undefined : round2(p.costPrice / per);
    if (p.stock !== undefined) v.stock = round2(p.stock * per);
    if (p.stockDelta !== undefined) v.stock = Math.max(0, round2((v.stock ?? 0) + p.stockDelta * per));
    if (p.ws) v.ws = { ...(v.ws ?? {}), ...p.ws };
    update.variants = variants;
    // Keep the product's own totals in step (lists and older screens read them).
    update.stock = round2(variants.reduce((s, x) => s + (x.stock || 0), 0));
    return update;
  }
  const per = stockPerWholesaleUnit(p.unit !== undefined ? `per ${p.unit}` : f.wholesale?.unit, stockUnitOf(f));
  if (p.sellPrice !== undefined || p.unit !== undefined) {
    update.wholesale = { ...(f.wholesale ?? { price: 0, unit: 'per bottle' }), ...(p.sellPrice !== undefined ? { price: p.sellPrice } : {}), ...(p.unit !== undefined ? { unit: `per ${p.unit}` } : {}) };
  }
  if (p.costPrice !== undefined) update.costPrice = p.costPrice === null ? 0 : round2(p.costPrice / per);
  if (p.stock !== undefined) update.stock = round2(p.stock * per);
  if (p.stockDelta !== undefined) update.stock = Math.max(0, round2((f.stock ?? 0) + p.stockDelta * per));
  if (p.ws) update.ws = { ...(f.ws ?? {}), ...p.ws };
  return update;
}
