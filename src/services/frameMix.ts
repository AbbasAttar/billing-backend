/**
 * Frame mix (/analytics/optics): what kind of frame sells — category, rim, shape, material, colour,
 * eye size, gender, reading type and addition — against what is on the shelf (pieces, cost, selling value).
 *
 * - A sale's attributes come from its bill-line snapshot, gaps filled from the frame record
 *   (see frameAttributes.ts). A sale with an attribute unknown counts in "untagged" for that view,
 *   so the coverage shown says how far each view can be trusted.
 * - Catch-all frames ("Quick Add", "Wholesale", "Unknown") count only through what the counter tagged.
 * - Stock: a frame's colour / size / power variants each count with their own attributes; pieces not
 *   split into variants count with the model's. Archived and catch-all frames are left out.
 * - Selling value uses the store tag, else the brand price.
 */

import { isCatchAllFrame } from './catchAllProducts';
import { ATTR_KEYS, type AttrKey, type FrameAttrs, frameDocAttrs, lineFrameAttrs } from './frameAttributes';
import { frameVariantName } from './invoiceLineProduct';

interface MixItem { frame?: unknown; type?: string; frameAttrs?: unknown; frameVariantLabel?: string | null; quantity?: number; price?: number; costPrice?: number }
interface MixInvoice { items?: (MixItem | string | null)[] }

const LABELS: Record<AttrKey, string> = {
  category: 'Category', readingType: 'Reading type', rim: 'Rim', shape: 'Shape', material: 'Material', gender: 'Gender',
  color: 'Colour', size: 'Eye size', power: 'Addition',
};
const CATEGORY_LABELS: Record<string, string> = { optical: 'Optical', sunglass: 'Sunglass', reading: 'Reading', kids: 'Kids' };

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : null);
const idOf = (v: unknown) => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : String(v ?? ''));

/** Display value for an attribute; colour / shape names group case-insensitively. */
export function attrValue(key: AttrKey, a: FrameAttrs): string | null {
  const v = a[key];
  if (v === undefined || v === null || v === '') return null;
  if (key === 'category') return CATEGORY_LABELS[v as string] ?? String(v);
  if (key === 'size') return `${v} mm`;
  if (key === 'power') return `+${Number(v).toFixed(2)}`;
  if (key === 'readingType') return String(v);
  const s = String(v).trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

interface Cell { units: number; revenue: number; cost: number; costedRevenue: number; stock: number; stockCost: number; stockValue: number }
const cell = (): Cell => ({ units: 0, revenue: 0, cost: 0, costedRevenue: 0, stock: 0, stockCost: 0, stockValue: 0 });

export function buildFrameMix(input: { invoices: MixInvoice[]; frames: any[] }) {
  const frameById = new Map(input.frames.map((f) => [idOf(f._id), f]));
  const dims = new Map<AttrKey, Map<string, Cell>>(ATTR_KEYS.map((k) => [k, new Map()]));
  const tagged = new Map<AttrKey, number>(ATTR_KEYS.map((k) => [k, 0]));
  let soldUnits = 0;
  let readingUnits = 0;

  const at = (k: AttrKey, value: string) => {
    const m = dims.get(k)!;
    const c = m.get(value) ?? cell();
    m.set(value, c);
    return c;
  };

  for (const inv of input.invoices) {
    for (const it of inv.items ?? []) {
      if (!it || typeof it !== 'object' || !(it.frame || it.type === 'frame')) continue;
      const doc = frameById.get(idOf(it.frame));
      const catchAll = !!doc && isCatchAllFrame(doc);
      // Catch-all lines only describe what the counter tagged; the frame record says nothing.
      const attrs = catchAll ? lineFrameAttrs(it, null) : lineFrameAttrs(it, doc);
      const qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
      const rev = qty * (it.price || 0);
      const costed = typeof it.costPrice === 'number' && it.costPrice > 0 && !catchAll;
      soldUnits += qty;
      if (attrs.category === 'reading') readingUnits += qty;
      for (const k of ATTR_KEYS) {
        const v = attrValue(k, attrs);
        if (!v) continue;
        tagged.set(k, tagged.get(k)! + qty);
        const c = at(k, v);
        c.units += qty;
        c.revenue += rev;
        if (costed) { c.cost += qty * it.costPrice!; c.costedRevenue += rev; }
      }
    }
  }

  // ── Shelf ──────────────────────────────────────────────────────────────────
  let stockUnits = 0, stockCost = 0, stockValue = 0, costedPieces = 0;
  const stockTagged = new Map<AttrKey, number>(ATTR_KEYS.map((k) => [k, 0]));
  const shelve = (attrs: FrameAttrs, pieces: number, f: any) => {
    if (pieces <= 0) return;
    const unitCost = f.costPrice > 0 ? f.costPrice : 0;
    const unitSell = f.storePrice || f.sellPrice || f.mrp || 0;
    stockUnits += pieces;
    stockCost += pieces * unitCost;
    stockValue += pieces * unitSell;
    if (unitCost) costedPieces += pieces;
    for (const k of ATTR_KEYS) {
      const v = attrValue(k, attrs);
      if (!v) continue;
      stockTagged.set(k, stockTagged.get(k)! + pieces);
      const c = at(k, v);
      c.stock += pieces;
      c.stockCost += pieces * unitCost;
      c.stockValue += pieces * unitSell;
    }
  };
  for (const f of input.frames) {
    if (f.isArchived || isCatchAllFrame(f)) continue;
    const total = f.stock && f.stock > 0 ? f.stock : 0;
    const variants: any[] = (f.web?.frameVariants ?? []).filter((v: any) => (v.stock ?? 0) > 0);
    let inVariants = 0;
    for (const v of variants) {
      shelve(frameDocAttrs(f, frameVariantName(v)), v.stock, f);
      inVariants += v.stock;
    }
    shelve(frameDocAttrs(f), total - inVariants, f);
  }

  const views = ATTR_KEYS.map((key) => {
    const base = key === 'power' || key === 'readingType' ? readingUnits : soldUnits;
    const rows = [...dims.get(key)!.entries()]
      .map(([value, c]) => ({
        value,
        units: c.units,
        revenue: r0(c.revenue),
        avgPrice: c.units > 0 ? r0(c.revenue / c.units) : null,
        marginPct: c.costedRevenue > 0 ? r1(((c.costedRevenue - c.cost) / c.costedRevenue) * 100) : null,
        salesSharePct: pct(c.units, tagged.get(key)!),
        inStock: c.stock,
        stockSharePct: pct(c.stock, stockTagged.get(key)!),
        stockCost: r0(c.stockCost),
        stockValue: r0(c.stockValue),
        sellThroughPct: pct(c.units, c.units + c.stock),
      }))
      .sort((a, b) => b.units - a.units || b.inStock - a.inStock);
    return {
      key,
      label: LABELS[key],
      soldUnits: base,
      taggedUnits: tagged.get(key)!,
      coveragePct: pct(tagged.get(key)!, base),
      stockTaggedPct: pct(stockTagged.get(key)!, stockUnits),
      rows,
    };
  });

  return {
    soldUnits,
    stock: {
      units: stockUnits,
      cost: r0(stockCost),
      sellValue: r0(stockValue),
      potentialProfit: r0(stockValue - stockCost),
      costCoveragePct: pct(costedPieces, stockUnits),
    },
    views,
  };
}
