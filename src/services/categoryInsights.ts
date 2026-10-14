/**
 * Category insights for the analytics pages: Optics (frames, lenses) and Fragrance (retail, wholesale).
 * Built only from recorded data — a figure that cannot be worked out (e.g. margin without cost prices)
 * is null or counted as "missing", never guessed. Guidance is a short list of things to act on.
 * Product lists may include archived records: they give names to old sales; stock figures skip them.
 */

export interface InsightItem {
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
  variants?: { label?: string; stock?: number; costPrice?: number }[];
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

// ── Optics ────────────────────────────────────────────────────────────────────

export function buildOpticsInsights(input: {
  invoices: InsightInvoice[];
  frames: FrameDoc[];
  lensStock: LensStockDoc[];
  days: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const frames = tally();
  const lenses = tally();
  const frameById = new Map(input.frames.map((f) => [idOf(f._id), f]));
  const topFrames = new Map<string, Ranked>();
  const brands = new Map<string, Ranked>();
  const lensTypes = new Map<string, Ranked>();
  const coatings = new Map<string, Ranked>();
  const soldFrameIds = new Set<string>();
  let frameBills = 0;
  let frameBillsWithLens = 0;

  for (const inv of input.invoices) {
    let hasFrame = false;
    let hasLens = false;
    for (const it of items(inv)) {
      const k = kind(it);
      if (k === 'frame') {
        hasFrame = true;
        add(frames, it);
        const id = idOf(it.frame);
        soldFrameIds.add(id);
        const doc = frameById.get(id);
        const brand = doc?.companyName || 'Unknown brand';
        bump(topFrames, id, () => ({ id, name: doc?.name || it.itemName || 'Frame', brand }), it);
        bump(brands, brand, () => ({ id: brand, name: brand }), it);
      } else if (k === 'lens') {
        hasLens = true;
        add(lenses, it);
        const type = it.lensType || it.lensCategory || 'Not recorded';
        bump(lensTypes, type, () => ({ id: type, name: type }), it);
        const coat = it.lensCoating || 'Not recorded';
        bump(coatings, coat, () => ({ id: coat, name: coat }), it);
      }
    }
    if (hasFrame) {
      frameBills += 1;
      if (hasLens) frameBillsWithLens += 1;
    }
  }

  // Frame stock by age since it was added (frames without a date are counted separately).
  const buckets = [
    { label: '0–90 days', min: 0, max: 90, units: 0, value: 0 },
    { label: '91–180 days', min: 91, max: 180, units: 0, value: 0 },
    { label: '181–365 days', min: 181, max: 365, units: 0, value: 0 },
    { label: '365+ days', min: 366, max: Infinity, units: 0, value: 0 },
  ];
  let stockUnits = 0;
  let stockValue = 0;
  let noCostFrames = 0;
  let undatedUnits = 0;
  const aged: { id: string; name: string; brand: string; ageDays: number; stock: number; value: number | null }[] = [];
  let unsoldUnits = 0;
  let unsoldValue = 0;

  for (const f of input.frames) {
    if (f.isArchived) continue;
    const stock = f.stock && f.stock > 0 ? f.stock : 0;
    if (!stock) continue;
    stockUnits += stock;
    const value = typeof f.costPrice === 'number' && f.costPrice > 0 ? stock * f.costPrice : null;
    if (value === null) noCostFrames += 1;
    else stockValue += value;
    if (!soldFrameIds.has(idOf(f._id))) {
      unsoldUnits += stock;
      unsoldValue += value ?? 0;
    }
    const created = f.createdAt ? new Date(f.createdAt) : null;
    if (!created || Number.isNaN(created.getTime())) {
      undatedUnits += stock;
      continue;
    }
    const ageDays = Math.max(0, Math.floor((now.getTime() - created.getTime()) / DAY));
    const b = buckets.find((x) => ageDays >= x.min && ageDays <= x.max)!;
    b.units += stock;
    b.value += value ?? 0;
    if (ageDays > 180) aged.push({ id: idOf(f._id), name: f.name || 'Frame', brand: f.companyName || '', ageDays, stock, value: value === null ? null : round(value) });
  }
  aged.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || b.ageDays - a.ageDays);

  // Out of stock powers (most powers hold 1 pair against a re-order level of 2, so "at re-order level" flags nearly all).
  const outPowers = input.lensStock.filter((s) => (s.quantity ?? 0) <= 0);
  const lowPowers = outPowers
    .map((s) => ({
      label: `${s.lensType ?? ''} ${s.coating ?? ''}`.trim(),
      sph: s.sph ?? 0, cyl: s.cyl ?? 0, add: s.add ?? null,
      quantity: s.quantity ?? 0, reorderLevel: s.reorderLevel ?? 0,
    }))
    .sort((a, b) => Math.abs(a.sph) - Math.abs(b.sph) || Math.abs(a.cyl) - Math.abs(b.cyl))
    .slice(0, 24);

  const attachPct = pct(frameBillsWithLens, frameBills);
  const agedValue = buckets[2].value + buckets[3].value;
  const guidance: Guidance[] = [];
  if (outPowers.length) {
    guidance.push({ level: 'high', title: `${outPowers.length} stock lens power${outPowers.length === 1 ? '' : 's'} out of stock`, detail: 'Re-order the common powers first (lowest numbers are listed first below).', href: '/lens-stock' });
  }
  if (aged.length) {
    guidance.push({
      level: agedValue > 0 ? 'medium' : 'info',
      title: `${aged.length} frame model${aged.length === 1 ? '' : 's'} in stock for over 6 months`,
      detail: agedValue > 0 ? `About ₹${round(agedValue).toLocaleString('en-IN')} at cost is sitting in old frames. Move them to the front, bundle with lenses, or mark down.` : 'Move them to the front, bundle with lenses, or mark down.',
      href: '/optics',
    });
  }
  if (attachPct !== null && frameBills >= 5 && attachPct < 60) {
    guidance.push({ level: 'medium', title: `Only ${attachPct}% of frame bills included lenses`, detail: 'Offer lenses with every frame sale (blue-cut / anti-glare upgrade).' });
  }
  if (frames.missingCost + lenses.missingCost > 0) {
    guidance.push({ level: 'info', title: `${frames.missingCost + lenses.missingCost} sold line${frames.missingCost + lenses.missingCost === 1 ? '' : 's'} without a cost price`, detail: 'Margins only count lines with a cost. Add cost prices to frames and lens purchases.' });
  }
  if (noCostFrames > 0) {
    guidance.push({ level: 'info', title: `${noCostFrames} frame${noCostFrames === 1 ? '' : 's'} in stock without a cost price`, detail: 'Stock value leaves these out until a cost is entered.', href: '/optics' });
  }
  const lowMargin = rank(topFrames, 50).filter((f) => f.marginPct !== null && f.marginPct < 30 && f.revenue > 0).slice(0, 5);
  if (lowMargin.length) {
    guidance.push({ level: 'medium', title: `${lowMargin.length} top-selling frame${lowMargin.length === 1 ? '' : 's'} under 30% margin`, detail: lowMargin.map((f) => `${f.name} (${f.marginPct}%)`).join(', ') });
  }

  return {
    days: input.days,
    frames: summary(frames),
    lenses: summary(lenses),
    lensAttachPct: attachPct,
    frameBills,
    topFrames: rank(topFrames),
    topBrands: rank(brands, 6),
    lensTypes: rank(lensTypes, 6),
    lensCoatings: rank(coatings, 6),
    frameStock: {
      units: stockUnits,
      value: round(stockValue),
      noCostFrames,
      undatedUnits,
      unsoldInPeriod: { units: unsoldUnits, value: round(unsoldValue) },
      buckets: buckets.map(({ label, units, value }) => ({ label, units, value: round(value) })),
      aged: aged.slice(0, 10),
    },
    lowPowers,
    outOfStockPowers: outPowers.length,
    guidance,
  };
}

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
  days: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const retail = tally();
  const wholesale = tally();
  const fragById = new Map(input.fragrances.map((f) => [idOf(f._id), f]));
  const wsById = new Map(input.wholesale.map((w) => [idOf(w._id), w]));
  const topRetail = new Map<string, Ranked>();
  const topWholesale = new Map<string, Ranked>();
  const types = new Map<string, Ranked>();
  const soldRetail = new Map<string, number>();

  for (const inv of input.invoices) {
    for (const it of items(inv)) {
      const k = kind(it);
      if (k === 'fragrance') {
        add(retail, it);
        const id = idOf(it.fragrance);
        const doc = fragById.get(id);
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
    .filter((f) => !f.isArchived && fragStock(f) > 0 && !soldRetail.has(idOf(f._id)))
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
  if (retail.missingCost + wholesale.missingCost > 0) {
    guidance.push({ level: 'info', title: `${retail.missingCost + wholesale.missingCost} sold line${retail.missingCost + wholesale.missingCost === 1 ? '' : 's'} without a cost price`, detail: 'Margins only count lines with a cost. Add cost prices to these products.' });
  }

  return {
    days: input.days,
    retail: summary(retail),
    wholesale: summary(wholesale),
    topRetail: rank(topRetail),
    topWholesale: rank(topWholesale),
    typeMix: rank(types, 6),
    soldOut,
    unsold: { count: unsold.length, value: round(unsoldValue), items: unsold.slice(0, 10) },
    wholesaleStock: { low: wsLow, onOrder, overdue: overdue.slice(0, 10) },
    guidance,
  };
}
