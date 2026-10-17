/**
 * Reading glasses (/analytics/reading): pieces on the shelf by power and colour, and what sold.
 *
 * - Reading frames: category "reading" (recorded, or guessed from the name), catch-all frames left out.
 * - Shelf: each variant counts at its power / colour; pieces of a frame not split into variants
 *   have no power, so they are listed as "power not set" for the counter to fix.
 * - Sales: bill lines whose logged (or recorded) category is reading, by the power and colour sold.
 *   Lines without a power count in the total only.
 * - Every shelf power from +1.00 to +3.00 is listed, so gaps show even at zero stock.
 */

import { isCatchAllFrame } from './catchAllProducts';
import { frameDocAttrs, formatPower, lineFrameAttrs, swatchFor } from './frameAttributes';
import { frameVariantName } from './invoiceLineProduct';

/** Readymade powers on the shelf: +1.00 to +3.00 in 0.25 steps. */
export const SHELF_POWERS = Array.from({ length: 9 }, (_, i) => 1 + i * 0.25);

interface RsItem { frame?: unknown; type?: string; frameAttrs?: unknown; frameVariantLabel?: string | null; quantity?: number; price?: number }
interface RsInvoice { items?: (RsItem | string | null)[] }

const idOf = (v: unknown) => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : String(v ?? ''));
const r0 = (n: number) => Math.round(n);
const NO_COLOUR = 'No colour';

interface Cell { stock: number; sold: number }
interface PowerRow { stock: number; sold: number; revenue: number; cost: number; sellValue: number; colors: Map<string, Cell>; types: Map<string, number> }
const powerRow = (): PowerRow => ({ stock: 0, sold: 0, revenue: 0, cost: 0, sellValue: 0, colors: new Map(), types: new Map() });

export function buildReadingStock(input: { invoices: RsInvoice[]; frames: any[]; days: number }) {
  const frameById = new Map(input.frames.map((f) => [idOf(f._id), f]));
  const isReading = (f: any) => !!f && !isCatchAllFrame(f) && frameDocAttrs(f).category === 'reading';

  const rows = new Map<number, PowerRow>(SHELF_POWERS.map((p) => [p, powerRow()]));
  const at = (p: number) => {
    const r = rows.get(p) ?? powerRow();
    rows.set(p, r);
    return r;
  };
  const colourCell = (r: PowerRow, c: string) => {
    const cell = r.colors.get(c) ?? { stock: 0, sold: 0 };
    r.colors.set(c, cell);
    return cell;
  };

  // ── Shelf ──────────────────────────────────────────────────────────────────
  let pieces = 0, cost = 0, sellValue = 0;
  const unassigned: { id: string; name: string; brand: string; pieces: number }[] = [];
  const models = new Set<string>();
  for (const f of input.frames) {
    if (f.isArchived || !isReading(f)) continue;
    models.add(idOf(f._id));
    const unitCost = f.costPrice > 0 ? f.costPrice : 0;
    const unitSell = f.storePrice || f.sellPrice || f.mrp || 0;
    let inVariants = 0;
    for (const v of f.web?.frameVariants ?? []) {
      const n = v.stock > 0 ? v.stock : 0;
      inVariants += n;
      const a = frameDocAttrs(f, frameVariantName(v));
      if (!n) continue;
      pieces += n;
      cost += n * unitCost;
      sellValue += n * unitSell;
      if (a.power === undefined) {
        unassigned.push({ id: idOf(f._id), name: f.name || 'Reading glasses', brand: f.companyName || '', pieces: n });
        continue;
      }
      const r = at(a.power);
      r.stock += n;
      r.cost += n * unitCost;
      r.sellValue += n * unitSell;
      colourCell(r, a.color ?? NO_COLOUR).stock += n;
      if (a.readingType) r.types.set(a.readingType, (r.types.get(a.readingType) ?? 0) + n);
    }
    const rest = (f.stock > 0 ? f.stock : 0) - inVariants;
    if (rest > 0) {
      pieces += rest;
      cost += rest * unitCost;
      sellValue += rest * unitSell;
      unassigned.push({ id: idOf(f._id), name: f.name || 'Reading glasses', brand: f.companyName || '', pieces: rest });
    }
  }

  // ── Sales ──────────────────────────────────────────────────────────────────
  let soldUnits = 0, soldNoPower = 0, revenue = 0;
  for (const inv of input.invoices) {
    for (const it of inv.items ?? []) {
      if (!it || typeof it !== 'object' || !(it.frame || it.type === 'frame')) continue;
      const doc = frameById.get(idOf(it.frame));
      const attrs = doc && isCatchAllFrame(doc) ? lineFrameAttrs(it, null) : lineFrameAttrs(it, doc);
      if (attrs.category !== 'reading') continue;
      const qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
      const rev = qty * (it.price || 0);
      soldUnits += qty;
      revenue += rev;
      if (attrs.power === undefined) { soldNoPower += qty; continue; }
      const r = at(attrs.power);
      r.sold += qty;
      r.revenue += rev;
      colourCell(r, attrs.color ?? NO_COLOUR).sold += qty;
    }
  }

  const colourNames = new Set<string>();
  for (const r of rows.values()) for (const c of r.colors.keys()) colourNames.add(c);
  const colors = [...colourNames]
    .sort((a, b) => (a === NO_COLOUR ? 1 : b === NO_COLOUR ? -1 : a.localeCompare(b)))
    .map((name) => ({ name, hex: name === NO_COLOUR ? null : swatchFor(name).hex }));

  const powers = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([power, r]) => ({
      power,
      label: formatPower(power),
      stock: r.stock,
      sold: r.sold,
      revenue: r0(r.revenue),
      cost: r0(r.cost),
      sellValue: r0(r.sellValue),
      colors: Object.fromEntries([...r.colors].map(([c, cell]) => [c, cell])),
      types: Object.fromEntries(r.types),
      status: r.stock === 0 ? (r.sold > 0 ? 'out-selling' : 'out') : r.stock <= 1 ? 'low' : 'ok',
    }));

  const outSelling = powers.filter((p) => p.status === 'out-selling');
  return {
    days: input.days,
    totals: {
      pieces, cost: r0(cost), sellValue: r0(sellValue), models: models.size,
      powersInStock: powers.filter((p) => p.stock > 0).length,
      powersEmpty: powers.filter((p) => p.stock === 0).length,
      soldUnits, soldNoPower, revenue: r0(revenue),
    },
    colors,
    powers,
    reorder: outSelling.map((p) => ({ power: p.label, sold: p.sold })),
    unassigned,
  };
}
