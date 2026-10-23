/**
 * Optics insights (/analytics/optics): frames and lenses, built only from recorded data.
 *
 * - Catch-all frames ("Unknown", "Wholesale", "Quick Add") count in revenue and their brand, but not
 *   in model rankings, price bands, margin or stock.
 * - Lens quantity is in pairs; a single-eye line is half a pair.
 * - Lens type comes from the category (Single Vision / Bifocal / Progressive); product names typed
 *   into the type field are grouped as "Other".
 * - Restock looks at stock lens powers that sold (by power) in the period and are now out of stock.
 *   Progressive lenses are made to order, so they are left out of restock.
 */

import { isCatchAllFrame } from './catchAllProducts';

export interface OxItem {
  frame?: unknown; opticalLens?: unknown; isCustomLens?: boolean; type?: string; fragrance?: unknown; wholesaleItem?: unknown;
  lensType?: string; lensCategory?: string; lensCoating?: string; lensMaterial?: string; lensColor?: string; eye?: string;
  rightSpherical?: number | null; rightCylinder?: number | null; rightAddition?: number | null;
  leftSpherical?: number | null; leftCylinder?: number | null; leftAddition?: number | null;
  spherical?: number | null; cylinder?: number | null; addition?: number | null;
  quantity?: number; price?: number; costPrice?: number;
}
export interface OxInvoice { billDate: Date | string; items?: (OxItem | string | null)[] }
export interface OxFrame { _id: unknown; name?: string; companyName?: string; type?: string; costPrice?: number; stock?: number; inwardDate?: Date | string; createdAt?: Date | string; isArchived?: boolean }
export interface OxLensStock { lensType?: string; material?: string; coating?: string; color?: string; sph?: number; cyl?: number; add?: number | null; quantity?: number }

export interface Guidance { level: 'high' | 'medium' | 'info'; title: string; detail: string; href?: string }

const DAY = 86_400_000;
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : null);
const idOf = (v: unknown) => (v && typeof v === 'object' && '_id' in (v as object) ? String((v as { _id: unknown })._id) : String(v ?? ''));
const lineItems = (inv: OxInvoice) => (inv.items ?? []).filter((x): x is OxItem => !!x && typeof x === 'object');

export const LENS_TYPES = ['Single Vision', 'Bifocal', 'Progressive'] as const;
export const COATINGS = ['Hard Coat', 'Anti-Reflective', 'Blue Cut', 'Other'] as const;

const isLens = (it: OxItem) => !!(it.opticalLens || it.isCustomLens || it.type === 'opticalLens' || it.lensType || it.lensCategory);
const isFrame = (it: OxItem) => !!(it.frame || it.type === 'frame');

/** Single Vision / Bifocal / Progressive, from the category first (the type field sometimes holds a product name). */
export function lensTypeOf(it: OxItem): string {
  for (const v of [it.lensCategory, it.lensType]) {
    const hit = LENS_TYPES.find((t) => t.toLowerCase() === (v ?? '').trim().toLowerCase());
    if (hit) return hit;
  }
  return 'Other';
}

/** Hard Coat (basic), Anti-Reflective, Blue Cut, or Other (night drive, tints…). */
export function coatingOf(it: OxItem): (typeof COATINGS)[number] {
  const c = (it.lensCoating ?? '').toLowerCase();
  if (!c || c.includes('hard')) return 'Hard Coat';
  if (c.includes('blue')) return 'Blue Cut';
  if (c.includes('anti') || c.includes('arc') || c.includes('reflect')) return 'Anti-Reflective';
  return 'Other';
}

/** Pairs on a lens line: a single-eye line is half a pair. */
export const lensPairs = (it: OxItem) => (it.quantity && it.quantity > 0 ? it.quantity : 1) * (it.eye === 'left' || it.eye === 'right' ? 0.5 : 1);

/** Lens type + coating group + power: a sale only counts as demand for stock of the same kind. */
const powerKey = (type: string, coating: string, sph: number, cyl: number, add: number | null | undefined) =>
  `${type}|${coating}|${(sph ?? 0).toFixed(2)}|${(cyl ?? 0).toFixed(2)}|${add ? add.toFixed(2) : ''}`;

/** Power keys sold on a lens line, one per eye. */
function soldPowers(it: OxItem): string[] {
  const type = lensTypeOf(it);
  const coating = coatingOf(it);
  const out: string[] = [];
  const eyes: [number | null | undefined, number | null | undefined, number | null | undefined, string][] = [
    [it.rightSpherical, it.rightCylinder, it.rightAddition, 'right'],
    [it.leftSpherical, it.leftCylinder, it.leftAddition, 'left'],
  ];
  let any = false;
  for (const [s, c, a, eye] of eyes) {
    if (typeof s !== 'number') continue;
    if (it.eye && it.eye !== 'both' && it.eye !== eye) continue;
    any = true;
    out.push(powerKey(type, coating, s, c ?? 0, a));
  }
  if (!any && typeof it.spherical === 'number') out.push(powerKey(type, coating, it.spherical, it.cylinder ?? 0, it.addition));
  return out;
}

/** Brand key so "Tulsi", "TULSI" and " tulsi " group together. */
const brandKey = (b?: string) => (b ?? '').trim().toLowerCase();

/** Edit distance ≤ 1 (one letter added, dropped, changed or swapped) — for spotting brand spelling variants. */
function nearlySame(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const restA = a.slice(i), restB = b.slice(i);
  return restA.slice(1) === restB.slice(1) || restA.slice(1) === restB || restA === restB.slice(1) ||
    (restA.length > 1 && restA[0] === restB[1] && restA[1] === restB[0] && restA.slice(2) === restB.slice(2));
}

export const PRICE_BANDS = [
  { label: 'Under ₹500', max: 499 },
  { label: '₹500–999', max: 999 },
  { label: '₹1,000–1,999', max: 1999 },
  { label: '₹2,000+', max: Infinity },
];

interface Sales { revenue: number; units: number; cost: number; costedRevenue: number; missingCost: number }
const emptySales = (): Sales => ({ revenue: 0, units: 0, cost: 0, costedRevenue: 0, missingCost: 0 });

function periodSales(invoices: OxInvoice[], frameById: Map<string, OxFrame>) {
  const frames = emptySales();
  const lenses = emptySales();
  let mixedFrames = 0;
  for (const inv of invoices) {
    for (const it of lineItems(inv)) {
      const rev = (it.quantity && it.quantity > 0 ? it.quantity : 1) * (it.price || 0);
      if (isFrame(it)) {
        const doc = frameById.get(idOf(it.frame));
        if (doc && isCatchAllFrame(doc)) { mixedFrames += rev; frames.revenue += rev; continue; }
        const qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
        frames.revenue += rev;
        frames.units += qty;
        if (typeof it.costPrice === 'number' && it.costPrice > 0) { frames.cost += qty * it.costPrice; frames.costedRevenue += rev; } else if (rev > 0) frames.missingCost += 1;
      } else if (isLens(it)) {
        lenses.revenue += rev;
        lenses.units += lensPairs(it);
        if (typeof it.costPrice === 'number' && it.costPrice > 0) { lenses.cost += (it.quantity || 1) * it.costPrice; lenses.costedRevenue += rev; } else if (rev > 0) lenses.missingCost += 1;
      }
    }
  }
  return { frames, lenses, mixedFrames };
}

const summary = (s: Sales, prevRevenue: number) => ({
  revenue: r0(s.revenue),
  previousRevenue: r0(prevRevenue),
  changePct: prevRevenue > 0 ? r1(((s.revenue - prevRevenue) / prevRevenue) * 100) : null,
  units: r1(s.units),
  marginPct: s.costedRevenue > 0 ? r1(((s.costedRevenue - s.cost) / s.costedRevenue) * 100) : null,
  coveragePct: pct(s.costedRevenue, s.revenue),
  missingCost: s.missingCost,
});

export function buildOpticsInsights(input: {
  invoices: OxInvoice[];
  previousInvoices: OxInvoice[];
  frames: OxFrame[];
  lensStock: OxLensStock[];
  days: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const frameById = new Map(input.frames.map((f) => [idOf(f._id), f]));
  const cur = periodSales(input.invoices, frameById);
  const prev = periodSales(input.previousInvoices, frameById);

  // ── Frames: models, brands, price bands ────────────────────────────────────
  type Row = { name: string; brand: string; units: number; revenue: number; cost: number; costedRevenue: number };
  const models = new Map<string, Row>();
  const brands = new Map<string, { label: string; units: number; revenue: number; cost: number; costedRevenue: number; mixedRevenue: number; spellings: Set<string> }>();
  const bands = PRICE_BANDS.map((b) => ({ label: b.label, units: 0, revenue: 0 }));
  const soldByFrame = new Map<string, number>();

  // ── Lenses: type × coating grid, retail attach, demand by power ───────────
  const grid = new Map<string, { units: number; revenue: number }>();
  const demand = new Map<string, number>();
  let retailFrameBills = 0;
  let retailFrameBillsWithLens = 0;
  let upgradedPairs = 0;
  let allPairs = 0;

  for (const inv of input.invoices) {
    let realFrame = false;
    let hasLens = false;
    for (const it of lineItems(inv)) {
      const qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
      const rev = qty * (it.price || 0);
      if (isFrame(it)) {
        const id = idOf(it.frame);
        const doc = frameById.get(id);
        const rawBrand = (doc?.companyName ?? '').trim();
        const key = brandKey(rawBrand) || '(no brand)';
        const b = brands.get(key) ?? { label: rawBrand || 'No brand', units: 0, revenue: 0, cost: 0, costedRevenue: 0, mixedRevenue: 0, spellings: new Set<string>() };
        if (rawBrand) b.spellings.add(rawBrand);
        b.revenue += rev;
        brands.set(key, b);
        if (doc && isCatchAllFrame(doc)) { b.mixedRevenue += rev; continue; }
        b.units += qty;
        const costed = typeof it.costPrice === 'number' && it.costPrice > 0;
        if (costed) { b.cost += qty * it.costPrice!; b.costedRevenue += rev; }
        const m = models.get(id) ?? { name: doc?.name || 'Frame', brand: rawBrand || 'No brand', units: 0, revenue: 0, cost: 0, costedRevenue: 0 };
        m.units += qty;
        m.revenue += rev;
        if (costed) { m.cost += qty * it.costPrice!; m.costedRevenue += rev; }
        models.set(id, m);
        soldByFrame.set(id, (soldByFrame.get(id) ?? 0) + qty);
        const unitPrice = it.price || 0;
        const band = bands[PRICE_BANDS.findIndex((x) => unitPrice <= x.max)];
        band.units += qty;
        band.revenue += rev;
        // Retail spectacle bill: a real frame that is not a sunglass.
        if (!(doc?.type ?? '').toLowerCase().includes('sun')) realFrame = true;
      } else if (isLens(it)) {
        hasLens = true;
        const pairs = lensPairs(it);
        const cell = `${lensTypeOf(it)}|${coatingOf(it)}`;
        const g = grid.get(cell) ?? { units: 0, revenue: 0 };
        g.units += pairs;
        g.revenue += rev;
        grid.set(cell, g);
        allPairs += pairs;
        if (coatingOf(it) !== 'Hard Coat') upgradedPairs += pairs;
        for (const k of soldPowers(it)) demand.set(k, (demand.get(k) ?? 0) + 1);
      }
    }
    if (realFrame) {
      retailFrameBills += 1;
      if (hasLens) retailFrameBillsWithLens += 1;
    }
  }

  // Stock per brand (catch-all frames left out) and sell-through.
  const stockByBrand = new Map<string, number>();
  let stockUnits = 0;
  let stockValue = 0;
  let framesNoCost = 0;
  let framesNoBrand = 0;
  let oldestEntry: number | null = null;
  const aged: { name: string; brand: string; ageDays: number; stock: number; value: number | null }[] = [];
  for (const f of input.frames) {
    if (f.isArchived || isCatchAllFrame(f)) continue;
    const stock = f.stock && f.stock > 0 ? f.stock : 0;
    if (!brandKey(f.companyName)) framesNoBrand += 1;
    if (!stock) continue;
    stockUnits += stock;
    const k = brandKey(f.companyName) || '(no brand)';
    stockByBrand.set(k, (stockByBrand.get(k) ?? 0) + stock);
    const value = f.costPrice && f.costPrice > 0 ? stock * f.costPrice : null;
    if (value === null) framesNoCost += 1; else stockValue += value;
    const arrival = f.inwardDate || f.createdAt;
    if (arrival) {
      const t = new Date(arrival).getTime();
      if (!Number.isNaN(t)) {
        oldestEntry = oldestEntry === null ? t : Math.min(oldestEntry, t);
        const ageDays = Math.floor((now.getTime() - t) / DAY);
        if (ageDays > 180) aged.push({ name: f.name || 'Frame', brand: f.companyName || '', ageDays, stock, value: value === null ? null : r0(value) });
      }
    }
  }
  const framesSoldUnits = [...models.values()].reduce((s, m) => s + m.units, 0);
  const sellThrough = pct(framesSoldUnits, framesSoldUnits + stockUnits);
  // Ageing is only meaningful once stock has been in the system long enough.
  const historyDays = oldestEntry === null ? 0 : Math.floor((now.getTime() - oldestEntry) / DAY);

  const brandRows = [...brands]
    .map(([key, b]) => {
      const inStock = stockByBrand.get(key) ?? 0;
      return {
        brand: b.label, units: b.units, revenue: r0(b.revenue), mixedRevenue: r0(b.mixedRevenue),
        avgPrice: b.units > 0 ? r0((b.revenue - b.mixedRevenue) / b.units) : null,
        marginPct: b.costedRevenue > 0 ? r1(((b.costedRevenue - b.cost) / b.costedRevenue) * 100) : null,
        inStock, sellThroughPct: pct(b.units, b.units + inStock),
        spellings: [...b.spellings],
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const topModels = [...models.entries()]
    .map(([id, m]) => ({
      id, name: m.name, brand: m.brand, units: m.units, revenue: r0(m.revenue), avgPrice: r0(m.revenue / m.units),
      marginPct: m.costedRevenue > 0 ? r1(((m.costedRevenue - m.cost) / m.costedRevenue) * 100) : null,
      inStock: frameById.get(id)?.stock ?? 0,
    }))
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
    .slice(0, 10);

  // Brand names that are probably the same brand spelled differently.
  const spellingIssues: string[][] = [];
  const keys = [...new Set([...brands.keys(), ...input.frames.map((f) => brandKey(f.companyName)).filter(Boolean)])].filter((k) => k !== '(no brand)');
  const seen = new Set<string>();
  for (const a of keys) {
    if (seen.has(a)) continue;
    const group = keys.filter((b) => !seen.has(b) && nearlySame(a, b));
    if (group.length > 1) {
      group.forEach((g) => seen.add(g));
      const names = new Set<string>();
      for (const f of input.frames) if (group.includes(brandKey(f.companyName))) names.add((f.companyName ?? '').trim());
      if (names.size > 1) spellingIssues.push([...names]);
    }
  }
  for (const b of brands.values()) if (b.spellings.size > 1 && !spellingIssues.some((g) => g.includes([...b.spellings][0]))) spellingIssues.push([...b.spellings]);

  // ── Lens grid ──────────────────────────────────────────────────────────────
  const lensTypes = [...LENS_TYPES, 'Other'];
  const lensGrid = lensTypes
    .map((type) => {
      const cells = COATINGS.map((coating) => {
        const g = grid.get(`${type}|${coating}`) ?? { units: 0, revenue: 0 };
        return { coating, pairs: r1(g.units), revenue: r0(g.revenue), avgPerPair: g.units > 0 ? r0(g.revenue / g.units) : null };
      });
      const pairs = cells.reduce((s, c) => s + c.pairs, 0);
      const revenue = cells.reduce((s, c) => s + c.revenue, 0);
      return { type, cells, pairs: r1(pairs), revenue, avgPerPair: pairs > 0 ? r0(revenue / pairs) : null };
    })
    .filter((row) => row.type !== 'Other' || row.pairs > 0);

  // ── Restock ────────────────────────────────────────────────────────────────
  const stockRows = input.lensStock.filter((s) => s.lensType !== 'Progressive');
  // The same lens and power is sometimes entered twice in lens stock: list it once.
  const outRows = [...new Map(
    stockRows
      .filter((s) => (s.quantity ?? 0) <= 0)
      .map((s) => [[s.lensType, s.material, s.coating, s.color, (s.sph ?? 0).toFixed(2), (s.cyl ?? 0).toFixed(2), s.add ? s.add.toFixed(2) : ''].join('|'), s] as const),
  ).values()];
  const restock = outRows
    .map((s) => ({
      lensType: s.lensType ?? '', material: s.material ?? '', coating: s.coating ?? '', color: s.color ?? '',
      sph: s.sph ?? 0, cyl: s.cyl ?? 0, add: s.add ?? null,
      sold: demand.get(powerKey(s.lensType ?? '', coatingOf({ lensCoating: s.coating }), s.sph ?? 0, s.cyl ?? 0, s.add)) ?? 0,
    }))
    .sort((a, b) => b.sold - a.sold || Math.abs(a.sph) - Math.abs(b.sph) || Math.abs(a.cyl) - Math.abs(b.cyl));
  const sellingOut = restock.filter((r) => r.sold > 0);

  // ── Guidance (at most 3, each with a number) ──────────────────────────────
  const attachPct = pct(retailFrameBillsWithLens, retailFrameBills);
  const upgradePct = pct(upgradedPairs, allPairs);
  const guidance: Guidance[] = [];
  if (sellingOut.length) {
    guidance.push({ level: 'high', title: `Re-order ${sellingOut.length} lens power${sellingOut.length === 1 ? '' : 's'} that sold and are out of stock`, detail: 'Use Create order in Restock below.', href: '#restock' });
  }
  if (upgradePct !== null && allPairs >= 10 && upgradePct < 50) {
    guidance.push({ level: 'medium', title: `Only ${upgradePct}% of lenses had an anti-reflective or blue-cut upgrade`, detail: 'Offer the upgrade on every hard-coat sale; it is the easiest extra margin.' });
  }
  const slowBrands = brandRows.filter((b) => b.inStock >= 10 && b.sellThroughPct !== null && b.sellThroughPct < 10).slice(0, 3);
  if (slowBrands.length) {
    guidance.push({ level: 'medium', title: `${slowBrands.length} brand${slowBrands.length === 1 ? '' : 's'} with stock but under 10% sell-through`, detail: slowBrands.map((b) => `${b.brand} (${b.inStock} in stock)`).join(', ') + '. Hold off re-buying these.' });
  }
  if (historyDays >= 180 && aged.length && guidance.length < 3) {
    guidance.push({ level: 'medium', title: `${aged.length} frame model${aged.length === 1 ? '' : 's'} in stock for over 6 months`, detail: 'Move to the front, bundle with lenses, or mark down.', href: '/optics' });
  }

  return {
    days: input.days,
    frames: { ...summary(cur.frames, prev.frames.revenue), avgPrice: cur.frames.units > 0 ? r0((cur.frames.revenue - cur.mixedFrames) / cur.frames.units) : null, mixedRevenue: r0(cur.mixedFrames) },
    lenses: { ...summary(cur.lenses, prev.lenses.revenue), avgPerPair: cur.lenses.units > 0 ? r0(cur.lenses.revenue / cur.lenses.units) : null, upgradePct },
    attach: { pct: attachPct, bills: retailFrameBills, withLens: retailFrameBillsWithLens },
    frameStock: {
      units: stockUnits, value: r0(stockValue), sellThroughPct: sellThrough, historyDays,
      aged: historyDays >= 180 ? aged.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 10) : [],
    },
    guidance: guidance.slice(0, 3),
    brands: brandRows.slice(0, 15),
    topModels,
    priceBands: bands.map((b) => ({ ...b, revenue: r0(b.revenue) })),
    lensGrid,
    restock: { sellingOut: sellingOut.length, outOfStock: outRows.length, rows: restock.slice(0, 60) },
    fixData: {
      framesMissingCost: cur.frames.missingCost,
      lensesMissingCost: cur.lenses.missingCost,
      framesInStockNoCost: framesNoCost,
      framesNoBrand,
      mixedFrameSales: r0(cur.mixedFrames),
      brandSpellings: spellingIssues.slice(0, 10),
    },
  };
}
