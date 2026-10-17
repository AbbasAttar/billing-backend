/**
 * Reading glasses (/analytics/reading): pieces on the shelf per reading frame (as entered, e.g.
 * "Metal Reading") and power, by frame type (Full / Supra / 3-piece), what sold, and what to order.
 *
 * - Reading frames: category "reading" (recorded, or guessed from the name), catch-all frames left out.
 * - Frame type is the frame's rim type (Full Rim / Half Rim = Supra / Rimless = 3-piece).
 * - Shelf: each variant counts at its power; pieces of a frame not split into variants have no
 *   power, so they are listed for the counter to fix.
 * - Sales: bill lines whose logged (or recorded) category is reading. Lines without a power count
 *   in the total only.
 * - Order: keep enough of each power for ORDER_COVER_DAYS at the rate it sold in the period, and
 *   never fewer than MIN_PER_POWER. Order = that target minus what is on the shelf.
 * - Every shelf power from +1.00 to +3.00 is listed, so gaps show even at zero stock.
 * - Powers outside it (e.g. +3.50, +4.00 left from older buying) show only while there is stock or
 *   a sale in the period, marked "clearance", and are never put on the order list.
 */

import { isCatchAllFrame } from './catchAllProducts';
import { frameDocAttrs, formatPower, lineFrameAttrs } from './frameAttributes';
import { frameVariantName } from './invoiceLineProduct';

/** Readymade powers on the shelf: +1.00 to +3.00 in 0.25 steps. */
export const SHELF_POWERS = Array.from({ length: 9 }, (_, i) => 1 + i * 0.25);
export const ORDER_COVER_DAYS = 60;
export const MIN_PER_POWER = 2;

/** Rim type as the counter says it. */
const TYPE_LABELS: Record<string, string> = { 'full rim': 'Full', 'half rim': 'Supra', rimless: '3-piece' };
const TYPE_ORDER = ['Full', 'Supra', '3-piece'];
export const frameTypeLabel = (rim?: string) => (rim ? TYPE_LABELS[rim.trim().toLowerCase()] ?? rim.trim() : 'Type not set');

interface RsItem { frame?: unknown; type?: string; frameAttrs?: unknown; frameVariantLabel?: string | null; quantity?: number; price?: number }
interface RsInvoice { items?: (RsItem | string | null)[] }

const idOf = (v: unknown) => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : String(v ?? ''));
const r0 = (n: number) => Math.round(n);

interface Cell { stock: number; sold: number }
interface PowerRow { stock: number; sold: number; revenue: number; cost: number; sellValue: number; types: Map<string, Cell> }
const powerRow = (): PowerRow => ({ stock: 0, sold: 0, revenue: 0, cost: 0, sellValue: 0, types: new Map() });

export function buildReadingStock(input: { invoices: RsInvoice[]; frames: any[]; days: number }) {
  const frameById = new Map(input.frames.map((f) => [idOf(f._id), f]));
  const isReading = (f: any) => !!f && !isCatchAllFrame(f) && frameDocAttrs(f).category === 'reading';

  const rows = new Map<number, PowerRow>(SHELF_POWERS.map((p) => [p, powerRow()]));
  const at = (p: number) => {
    const r = rows.get(p) ?? powerRow();
    rows.set(p, r);
    return r;
  };
  const typeCell = (r: PowerRow, t: string) => {
    const cell = r.types.get(t) ?? { stock: 0, sold: 0 };
    r.types.set(t, cell);
    return cell;
  };

  // ── Shelf ──────────────────────────────────────────────────────────────────
  let pieces = 0, cost = 0, sellValue = 0;
  const unassigned: { id: string; name: string; brand: string; pieces: number }[] = [];
  const models = new Set<string>();
  const modelsByType = new Map<string, number>();
  /** Per reading frame: pieces and sales at each power. */
  const frameRows = new Map<string, { id: string; name: string; brand: string; type: string; readingType: string | null; powers: Map<number, Cell>; noPower: number }>();
  const frameRow = (f: any) => {
    const id = idOf(f._id);
    let row = frameRows.get(id);
    if (!row) {
      const a = frameDocAttrs(f);
      row = { id, name: f.houseName || f.name || 'Reading glasses', brand: f.companyName || '', type: frameTypeLabel(a.rim), readingType: a.readingType ?? null, powers: new Map(), noPower: 0 };
      frameRows.set(id, row);
    }
    return row;
  };
  const frameCell = (f: any, p: number) => {
    const row = frameRow(f);
    const c = row.powers.get(p) ?? { stock: 0, sold: 0 };
    row.powers.set(p, c);
    return c;
  };
  for (const f of input.frames) {
    if (f.isArchived || !isReading(f)) continue;
    models.add(idOf(f._id));
    const type = frameTypeLabel(frameDocAttrs(f).rim);
    modelsByType.set(type, (modelsByType.get(type) ?? 0) + 1);
    const unitCost = f.costPrice > 0 ? f.costPrice : 0;
    const unitSell = f.storePrice || f.sellPrice || f.mrp || 0;
    let inVariants = 0;
    for (const v of f.web?.frameVariants ?? []) {
      const n = v.stock > 0 ? v.stock : 0;
      inVariants += n;
      if (!n) continue;
      const a = frameDocAttrs(f, frameVariantName(v));
      pieces += n;
      cost += n * unitCost;
      sellValue += n * unitSell;
      if (a.power === undefined) {
        unassigned.push({ id: idOf(f._id), name: f.name || 'Reading glasses', brand: f.companyName || '', pieces: n });
        frameRow(f).noPower += n;
        continue;
      }
      frameCell(f, a.power).stock += n;
      const r = at(a.power);
      r.stock += n;
      r.cost += n * unitCost;
      r.sellValue += n * unitSell;
      typeCell(r, type).stock += n;
    }
    const rest = (f.stock > 0 ? f.stock : 0) - inVariants;
    if (rest > 0) {
      pieces += rest;
      cost += rest * unitCost;
      sellValue += rest * unitSell;
      unassigned.push({ id: idOf(f._id), name: f.name || 'Reading glasses', brand: f.companyName || '', pieces: rest });
      frameRow(f).noPower += rest;
    } else {
      frameRow(f);
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
      if (doc && isReading(doc)) frameCell(doc, attrs.power).sold += qty;
      const r = at(attrs.power);
      r.sold += qty;
      r.revenue += rev;
      typeCell(r, frameTypeLabel(attrs.rim)).sold += qty;
    }
  }

  const typeNames = new Set<string>();
  for (const r of rows.values()) for (const t of r.types.keys()) typeNames.add(t);
  for (const t of modelsByType.keys()) typeNames.add(t);
  const rank = (t: string) => (TYPE_ORDER.includes(t) ? TYPE_ORDER.indexOf(t) : TYPE_ORDER.length);
  const types = [...typeNames].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const target = (sold: number) => Math.max(MIN_PER_POWER, Math.ceil((sold / Math.max(input.days, 1)) * ORDER_COVER_DAYS));

  const powers = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([power, r]) => {
      const stocked = SHELF_POWERS.includes(power);
      // Clearance powers: sell what is left, never re-order.
      const keep = stocked ? target(r.sold) : 0;
      return {
        power,
        label: formatPower(power),
        stock: r.stock,
        sold: r.sold,
        revenue: r0(r.revenue),
        cost: r0(r.cost),
        sellValue: r0(r.sellValue),
        types: Object.fromEntries([...r.types]),
        target: keep,
        order: Math.max(0, keep - r.stock),
        stocked,
        status: !stocked ? 'clearance' : r.stock === 0 ? (r.sold > 0 ? 'out-selling' : 'out') : r.stock <= 1 ? 'low' : 'ok',
      };
    });

  // Per frame type: pieces, models, and the power it holds most of / sells most.
  const byType = types.map((t) => {
    const cells = powers.map((p) => ({ label: p.label, ...(p.types[t] ?? { stock: 0, sold: 0 }) }));
    const most = cells.reduce((best, c) => (c.stock > best.stock ? c : best), { label: '', stock: 0, sold: 0 });
    const top = cells.reduce((best, c) => (c.sold > best.sold ? c : best), { label: '', stock: 0, sold: 0 });
    return {
      type: t,
      models: modelsByType.get(t) ?? 0,
      pieces: cells.reduce((s, c) => s + c.stock, 0),
      sold: cells.reduce((s, c) => s + c.sold, 0),
      mostStocked: most.stock > 0 ? { power: most.label, pieces: most.stock } : null,
      topSeller: top.sold > 0 ? { power: top.label, sold: top.sold } : null,
      emptyPowers: cells.filter((c) => c.stock === 0 && SHELF_POWERS.some((p) => formatPower(p) === c.label)).map((c) => c.label),
    };
  });

  // Order list: biggest gap first; the frame type that sold most of the power (else holds most) to buy in.
  const order = powers
    .filter((p) => p.order > 0)
    .map((p) => {
      const entries = Object.entries(p.types);
      const bySales = entries.filter(([, c]) => c.sold > 0).sort((a, b) => b[1].sold - a[1].sold)[0];
      const byStock = entries.filter(([, c]) => c.stock > 0).sort((a, b) => b[1].stock - a[1].stock)[0];
      return {
        power: p.label, stock: p.stock, sold: p.sold, order: p.order,
        reason: p.sold > 0 ? (p.stock === 0 ? 'sold out' : 'selling faster than stock') : p.stock === 0 ? 'none on the shelf' : 'below minimum',
        type: (bySales ?? byStock)?.[0] ?? null,
      };
    })
    .sort((a, b) => b.sold - a.sold || b.order - a.order);

  // Frame × power table: every reading frame entered, by type then name.
  const shelf = rows.size ? [...rows.keys()].sort((a, b) => a - b) : SHELF_POWERS;
  const frames = [...frameRows.values()]
    .map((f) => ({
      id: f.id, name: f.name, brand: f.brand, type: f.type, readingType: f.readingType,
      powers: Object.fromEntries(shelf.map((p) => [formatPower(p), f.powers.get(p) ?? { stock: 0, sold: 0 }])),
      stock: [...f.powers.values()].reduce((s, c) => s + c.stock, 0),
      sold: [...f.powers.values()].reduce((s, c) => s + c.sold, 0),
      noPower: f.noPower,
    }))
    .sort((a, b) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name));

  return {
    days: input.days,
    powerLabels: shelf.map(formatPower),
    /** Power columns outside the +1.00…+3.00 shelf, kept only until sold. */
    clearanceLabels: shelf.filter((p) => !SHELF_POWERS.includes(p)).map(formatPower),
    frames,
    rule: { coverDays: ORDER_COVER_DAYS, minPerPower: MIN_PER_POWER },
    totals: {
      pieces, cost: r0(cost), sellValue: r0(sellValue), models: models.size,
      powersInStock: powers.filter((p) => p.stocked && p.stock > 0).length,
      powersEmpty: powers.filter((p) => p.stocked && p.stock === 0).length,
      soldUnits, soldNoPower, revenue: r0(revenue),
      toOrder: order.reduce((s, o) => s + o.order, 0),
    },
    types,
    byType,
    powers,
    order,
    unassigned,
  };
}
