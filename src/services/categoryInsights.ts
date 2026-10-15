import { isCatchAllFragrance, isCatchAllFrame } from './catchAllProducts';

/**
 * Category insights for the analytics pages: Optics (frames, lenses) and Fragrance (retail, wholesale).
 * Built only from recorded data — a figure that cannot be worked out (e.g. margin without cost prices)
 * is null or counted as "missing", never guessed. Guidance is a short list of things to act on.
 * Product lists may include archived records: they give names to old sales; stock figures skip them.
 */

export interface InsightItem {
  fragranceGrade?: string;
  frame?: unknown;
  fragrance?: unknown;
  wholesaleItem?: unknown;
  opticalLens?: unknown;
  isCustomLens?: boolean;
  type?: string;
  itemName?: string;
  lensType?: string;
  lensCategory?: string;
  lensCoating?: string;
  quantity?: number;
  price?: number;
  costPrice?: number;
}

export interface InsightInvoice {
  _id?: unknown;
  billDate: Date | string;
  items?: (InsightItem | null | string)[];
}

export interface FrameDoc { _id: unknown; isArchived?: boolean; name?: string; companyName?: string; costPrice?: number; sellPrice?: number; stock?: number; createdAt?: Date | string }
export interface LensStockDoc { lensType?: string; coating?: string; sph?: number; cyl?: number; add?: number | null; quantity?: number; reorderLevel?: number }
export interface FragranceDoc {
  _id: unknown; isArchived?: boolean; name?: string; companyName?: string; type?: string; costPrice?: number; stock?: number;
  variants?: { label?: string; stock?: number; costPrice?: number; sellPrice?: number }[];
}
export interface WholesaleDoc {
  _id: unknown; isArchived?: boolean; name?: string; companyName?: string; unit?: string; costPrice?: number | null; stock?: number;
  reorderLevel?: number | null; isOrdered?: boolean; orderedQty?: number | null; orderedAt?: Date | string | null;
}

export type GuidanceLevel = 'high' | 'medium' | 'info';
export interface Guidance { level: GuidanceLevel; title: string; detail: string; href?: string }

interface Tally { revenue: number; units: number; cost: number; costedRevenue: number; missingCost: number }
const tally = (): Tally => ({ revenue: 0, units: 0, cost: 0, costedRevenue: 0, missingCost: 0 });

const idOf = (v: unknown): string => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : String(v ?? ''));
const DAY = 86_400_000;

/** A catch-all line: revenue counts, but no cost, margin or product to list (see catchAllProducts.ts). */
function addRevenueOnly(t: Tally, item: InsightItem) {
  const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
  t.revenue += qty * (item.price || 0);
  t.units += qty;
}
const round = (n: number) => Math.round(n);
/** Attar is sold by part bottles, so units can be fractional. */
const units = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : null);

function add(t: Tally, item: InsightItem) {
  const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
  const rev = qty * (item.price || 0);
  t.revenue += rev;
  t.units += qty;
  if (typeof item.costPrice === 'number' && item.costPrice > 0) {
    t.cost += qty * item.costPrice;
    t.costedRevenue += rev;
  } else if (rev > 0) {
    t.missingCost += 1;
  }
}

/** Margin over the lines that have a cost price; null when none do. */
const summary = (t: Tally) => ({
  revenue: round(t.revenue),
  units: units(t.units),
  marginPct: t.costedRevenue > 0 ? Number((((t.costedRevenue - t.cost) / t.costedRevenue) * 100).toFixed(1)) : null,
  missingCost: t.missingCost,
});

type Ranked = { id: string; name: string; brand?: string; units: number; revenue: number; cost: number; costedRevenue: number };
function rank(map: Map<string, Ranked>, limit = 8) {
  return [...map.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
    .map((r) => ({
      id: r.id, name: r.name, brand: r.brand, units: units(r.units), revenue: round(r.revenue),
      marginPct: r.costedRevenue > 0 ? Number((((r.costedRevenue - r.cost) / r.costedRevenue) * 100).toFixed(1)) : null,
    }));
}
function bump(map: Map<string, Ranked>, key: string, init: () => Omit<Ranked, 'units' | 'revenue' | 'cost' | 'costedRevenue'>, item: InsightItem) {
  const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
  const rev = qty * (item.price || 0);
  const r = map.get(key) ?? { ...init(), units: 0, revenue: 0, cost: 0, costedRevenue: 0 };
  r.units += qty;
  r.revenue += rev;
  if (typeof item.costPrice === 'number' && item.costPrice > 0) {
    r.cost += qty * item.costPrice;
    r.costedRevenue += rev;
  }
  map.set(key, r);
}

const kind = (it: InsightItem): 'wholesale' | 'frame' | 'fragrance' | 'lens' | 'other' => {
  if (it.wholesaleItem || it.type === 'wholesale') return 'wholesale';
  if (it.frame || it.type === 'frame') return 'frame';
  if (it.fragrance || it.type === 'fragrance') return 'fragrance';
  if (it.opticalLens || it.isCustomLens || it.type === 'opticalLens' || it.lensType) return 'lens';
  return 'other';
};

const items = (inv: InsightInvoice) => (inv.items ?? []).filter((x): x is InsightItem => !!x && typeof x === 'object');

// ── Fragrance ─────────────────────────────────────────────────────────────────

const fragStock = (f: FragranceDoc) => (f.variants?.length ? f.variants.reduce((s, v) => s + (v.stock ?? 0), 0) : f.stock ?? 0);
const fragValue = (f: FragranceDoc): number | null => {
  if (f.variants?.length) {
    let v = 0;
    for (const x of f.variants) {
      const c = x.costPrice ?? f.costPrice;
      if ((x.stock ?? 0) > 0 && !(c && c > 0)) return null;
      v += (x.stock ?? 0) * (c ?? 0);
    }
    return v;
  }
  return f.costPrice && f.costPrice > 0 ? (f.stock ?? 0) * f.costPrice : null;
};

export function buildFragranceInsights(input: {
  invoices: InsightInvoice[];
  fragrances: FragranceDoc[];
  wholesale: WholesaleDoc[];
  /** Old wholesale items, only to name lines on bills made before the catalogue merge. */
  legacyWholesale?: WholesaleDoc[];
  days: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const retail = tally();
  const wholesale = tally();
  const fragById = new Map(input.fragrances.map((f) => [idOf(f._id), f]));
  const wsById = new Map([...(input.legacyWholesale ?? []), ...input.wholesale].map((w) => [idOf(w._id), w]));
  const topRetail = new Map<string, Ranked>();
  const topWholesale = new Map<string, Ranked>();
  const types = new Map<string, Ranked>();
  const soldRetail = new Map<string, number>();
  let fragMixed = 0;
  const soldNoCost = new Map<string, { id: string; name: string; brand?: string; type?: string; sold: number; revenue: number }>();
  /** Margin uses the cost saved on the fragrance (its size variant first), not the cost copied onto the bill. */
  const savedCost = (doc: FragranceDoc | undefined, grade?: string) => {
    if (!doc) return null;
    const v = grade && doc.variants?.length ? doc.variants.find((x) => x.label === grade) : undefined;
    const c = v?.costPrice || doc.costPrice;
    return c && c > 0 ? c : null;
  };

  for (const inv of input.invoices) {
    for (let it of items(inv)) {
      const k = kind(it);
      if (k === 'fragrance' && fragById.get(idOf(it.fragrance)) && isCatchAllFragrance(fragById.get(idOf(it.fragrance))!)) {
        // "Wholesale" / "Attar" catch-alls: mixed or unnoted sales. Revenue only.
        addRevenueOnly(retail, it);
        fragMixed += (it.quantity || 1) * (it.price || 0);
        continue;
      }
      if (k === 'fragrance') {
        const id = idOf(it.fragrance);
        const doc = fragById.get(id);
        const cost = savedCost(doc, it.fragranceGrade);
        it = { ...it, costPrice: cost ?? undefined };
        if (cost === null) {
          const qty = it.quantity || 1;
          const row = soldNoCost.get(id) ?? { id, name: doc?.name || it.itemName || 'Fragrance', brand: doc?.companyName, type: doc?.type, sold: 0, revenue: 0 };
          row.sold = units(row.sold + qty);
          row.revenue += qty * (it.price || 0);
          soldNoCost.set(id, row);
        }
        add(retail, it);
        soldRetail.set(id, units((soldRetail.get(id) ?? 0) + (it.quantity || 1)));
        bump(topRetail, id, () => ({ id, name: doc?.name || it.itemName || 'Fragrance', brand: doc?.companyName }), it);
        const t = doc?.type || 'Not recorded';
        bump(types, t, () => ({ id: t, name: t }), it);
      } else if (k === 'wholesale') {
        add(wholesale, it);
        const id = idOf(it.wholesaleItem) || it.itemName || 'wholesale';
        const doc = wsById.get(id);
        bump(topWholesale, id, () => ({ id, name: doc?.name || it.itemName || 'Wholesale item', brand: doc?.companyName }), it);
      }
    }
  }

  // Retail: best sellers now out of stock, and stock that did not sell in the period.
  const soldOut = [...soldRetail]
    .map(([id, sold]) => ({ f: fragById.get(id), sold }))
    .filter((x): x is { f: FragranceDoc; sold: number } => !!x.f && !x.f.isArchived && fragStock(x.f) <= 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 10)
    .map(({ f, sold }) => ({ id: idOf(f._id), name: f.name || 'Fragrance', brand: f.companyName, sold }));
  const unsold = input.fragrances
    .filter((f) => !f.isArchived && (f as { channels?: { retail?: boolean } }).channels?.retail !== false && !isCatchAllFragrance(f) && fragStock(f) > 0 && !soldRetail.has(idOf(f._id)))
    .map((f) => ({ id: idOf(f._id), name: f.name || 'Fragrance', brand: f.companyName, stock: fragStock(f), value: fragValue(f) }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const unsoldValue = unsold.reduce((s, u) => s + (u.value ?? 0), 0);

  // Wholesale stock: low and not ordered, and orders waiting more than a week.
  const isLow = (w: WholesaleDoc) => (w.stock ?? 0) <= 0 || (w.reorderLevel != null && (w.stock ?? 0) <= w.reorderLevel);
  const wsLow = input.wholesale
    .filter((w) => !w.isArchived && isLow(w) && !w.isOrdered)
    .map((w) => ({ id: idOf(w._id), name: w.name || 'Item', brand: w.companyName, stock: w.stock ?? 0, reorderLevel: w.reorderLevel ?? null, unit: w.unit || 'bottle' }))
    .slice(0, 15);
  const overdue = input.wholesale
    .filter((w) => !w.isArchived && w.isOrdered && w.orderedAt && now.getTime() - new Date(w.orderedAt).getTime() > 7 * DAY)
    .map((w) => ({ id: idOf(w._id), name: w.name || 'Item', brand: w.companyName, orderedQty: w.orderedQty ?? null, days: Math.floor((now.getTime() - new Date(w.orderedAt as Date).getTime()) / DAY) }))
    .sort((a, b) => b.days - a.days);
  const onOrder = input.wholesale.filter((w) => !w.isArchived && w.isOrdered).length;

  const guidance: Guidance[] = [];
  if (soldOut.length) {
    guidance.push({ level: 'high', title: `${soldOut.length} fragrance${soldOut.length === 1 ? '' : 's'} that sold in this period are now out of stock`, detail: soldOut.slice(0, 5).map((s) => s.name).join(', '), href: '/fragrance' });
  }
  if (wsLow.length) {
    guidance.push({ level: 'high', title: `${wsLow.length} wholesale item${wsLow.length === 1 ? '' : 's'} low and not ordered`, detail: 'Add them to the next wholesale order.', href: '/bulk-stock/order' });
  }
  if (overdue.length) {
    guidance.push({ level: 'medium', title: `${overdue.length} wholesale order${overdue.length === 1 ? '' : 's'} waiting more than 7 days`, detail: 'Follow up with the wholesaler, or mark them Not coming.', href: '/bulk-stock/order' });
  }
  if (unsold.length) {
    guidance.push({
      level: 'medium',
      title: `${unsold.length} fragrance${unsold.length === 1 ? '' : 's'} in stock did not sell in this period`,
      detail: unsoldValue > 0 ? `About ₹${round(unsoldValue).toLocaleString('en-IN')} at cost. Offer testers, bundle, or put them on display.` : 'Offer testers, bundle, or put them on display.',
      href: '/fragrance',
    });
  }
  const lowMargin = [...rank(topRetail, 50), ...rank(topWholesale, 50)].filter((x) => x.marginPct !== null && x.marginPct < 25 && x.revenue > 0).slice(0, 5);
  if (lowMargin.length) {
    guidance.push({ level: 'medium', title: `${lowMargin.length} selling item${lowMargin.length === 1 ? '' : 's'} under 25% margin`, detail: lowMargin.map((x) => `${x.name} (${x.marginPct}%)`).join(', ') });
  }
  const noCostList = [...soldNoCost.values()].sort((a, b) => b.revenue - a.revenue).map((r) => ({ ...r, revenue: round(r.revenue) }));
  if (noCostList.length) {
    guidance.push({ level: 'medium', title: `${noCostList.length} fragrance${noCostList.length === 1 ? '' : 's'} sold without a saved cost price`, detail: 'Their margin is unknown. Open Fragrance → "No cost price" and enter the cost.', href: '/fragrance' });
  }
  if (wholesale.missingCost > 0) {
    guidance.push({ level: 'info', title: `${wholesale.missingCost} wholesale line${wholesale.missingCost === 1 ? '' : 's'} sold without a cost price`, detail: 'Enter the cost on the wholesale item (or on the next delivery).', href: '/bulk-stock' });
  }

  return {
    days: input.days,
    retail: summary(retail),
    mixedSales: { revenue: round(fragMixed), note: 'Billed as "Wholesale" or "Attar" (mixed or unnoted sales): in revenue, not in margin or top sellers' },
    wholesale: summary(wholesale),
    topRetail: rank(topRetail),
    topWholesale: rank(topWholesale),
    typeMix: rank(types, 6),
    soldOut,
    soldWithoutCost: noCostList.slice(0, 15),
    unsold: { count: unsold.length, value: round(unsoldValue), items: unsold.slice(0, 10) },
    wholesaleStock: { low: wsLow, onOrder, overdue: overdue.slice(0, 10) },
    guidance,
  };
}
