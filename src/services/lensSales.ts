/**
 * Shared lens-sales arithmetic for the lens analytics endpoints (/optical-lenses/analytics,
 * /lens-stock/sold, /lens-stock/demand). One set of rules so the tabs agree:
 *
 * - Lens line quantity is in pairs. A single-eye line (eye 'right' | 'left') is half a pair.
 * - Pieces are physical lenses: one per eye the line covers, times quantity.
 * - Revenue is counted once per line (price × quantity). When a line is split into eyes, each eye
 *   gets its share, so the eyes add back up to the line.
 * - Only eyes the line actually covers count (a right-eye line ignores any left power stored on it).
 * - Powers are compared in minus cyl, the way stock is kept.
 */
import { toMinusCyl } from '../utils/lensPower';

export interface LensLine {
  _id?: unknown;
  createdAt?: Date | string;
  type?: string | null;
  opticalLens?: unknown;
  isCustomLens?: boolean;
  lensBrand?: string | null; lensName?: string | null; lensIndex?: string | null;
  lensCategory?: string | null; lensCoating?: string | null;
  lensType?: string | null; lensMaterial?: string | null; lensColor?: string | null;
  eye?: 'right' | 'left' | 'both' | string | null;
  rightSpherical?: number | null; rightCylinder?: number | null; rightAxis?: number | null; rightAddition?: number | null;
  leftSpherical?: number | null; leftCylinder?: number | null; leftAxis?: number | null; leftAddition?: number | null;
  spherical?: number | null; cylinder?: number | null; addition?: number | null;
  quantity?: number | null;
  price?: number | null;
  costPrice?: number | null;
}

export interface EyeSale {
  eye: 'right' | 'left' | 'single';
  sph: number;
  cyl: number;
  add: number | null;
  /** Physical lenses for this eye (= line quantity). */
  pieces: number;
  /** This eye's share of the line revenue. */
  revenue: number;
  /** Selling price of one lens. */
  unitPrice: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Lens type as the shop counts it. The lab order form saved Kryptok lines as "Kryptok Bifocal";
 * the shop's Bifocal is the Kryptok, so they are one type (D-Bifocal stays separate).
 */
export function canonicalLensType<T extends string | null | undefined>(t: T): T | 'Bifocal' {
  return typeof t === 'string' && /^\s*(kryptok|kt)\s*bifocal\s*$/i.test(t) ? 'Bifocal' : t;
}

/** Copy of a line with lens type / category in the shop's names (see canonicalLensType). */
export function normalizeLensLine<T extends LensLine>(it: T): T {
  const lensType = canonicalLensType(it.lensType);
  const lensCategory = canonicalLensType(it.lensCategory);
  return lensType === it.lensType && lensCategory === it.lensCategory ? it : { ...it, lensType, lensCategory };
}

/** Quantity on a line; missing or zero counts as 1 (older lines). */
export const lineQty = (it: LensLine) => (typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1);

/** Line revenue, counted once. */
export const lineRevenue = (it: LensLine) => lineQty(it) * (num(it.price) ?? 0);

/** Pairs on a line: a single-eye line is half a pair. */
export const linePairs = (it: LensLine) => lineQty(it) * (it.eye === 'right' || it.eye === 'left' ? 0.5 : 1);

/**
 * A lens line: catalogue lens, custom lens, lens kind (counter / lab lines), or a lens brand / name
 * typed in. Same idea as isLens in opticsInsights, so /analytics/lens and /analytics/optics agree.
 */
export const isLensLine = (it: LensLine) =>
  !!(it.opticalLens || it.isCustomLens || it.type === 'opticalLens' || it.lensType || it.lensCategory || it.lensBrand || it.lensName);

/** A ready-stock style line: lens kind recorded, so it can be matched to stock. */
export const hasLensKind = (it: LensLine) => !!(it.lensType && it.lensMaterial);

function eyePower(sph: unknown, cyl: unknown, axis: unknown, add: unknown) {
  const s = num(sph);
  if (s === null) return null;
  const p = toMinusCyl(r2(s), r2(num(cyl) ?? 0), num(axis));
  const a = num(add);
  return { sph: r2(p.sph) || 0, cyl: r2(p.cyl) || 0, add: a !== null && a > 0 ? r2(a) : null };
}

/**
 * The lenses a line sold, one entry per eye it covers. Lines with only the old flat fields
 * (spherical / cylinder / addition) give one 'single' entry.
 */
export function eyeSales(it: LensLine): EyeSale[] {
  const eye = it.eye === 'right' || it.eye === 'left' ? it.eye : 'both';
  const powers: { eye: EyeSale['eye']; p: NonNullable<ReturnType<typeof eyePower>> }[] = [];
  if (eye !== 'left') {
    const p = eyePower(it.rightSpherical, it.rightCylinder, it.rightAxis, it.rightAddition);
    if (p) powers.push({ eye: 'right', p });
  }
  if (eye !== 'right') {
    const p = eyePower(it.leftSpherical, it.leftCylinder, it.leftAxis, it.leftAddition);
    if (p) powers.push({ eye: 'left', p });
  }
  if (powers.length === 0 && num(it.rightSpherical) === null && num(it.leftSpherical) === null) {
    const p = eyePower(it.spherical, it.cylinder, null, it.addition);
    if (p) powers.push({ eye: 'single', p });
  }
  if (powers.length === 0) return [];

  const qty = lineQty(it);
  const revenue = lineRevenue(it);
  // A pair line priced for two lenses: each lens is half. A single-eye line is priced for one.
  const lensesPriced = eye === 'both' ? 2 : 1;
  const unitPrice = (num(it.price) ?? 0) / lensesPriced;
  return powers.map(({ eye: e, p }) => ({
    eye: e, ...p, pieces: qty, revenue: revenue / powers.length, unitPrice,
  }));
}

/** Power text used as a group key. */
export const powerKey = (s: { sph: number; cyl: number; add: number | null }) => `${s.sph}|${s.cyl}|${s.add ?? ''}`;

/** "+1.25" style label. */
export const signed = (n: number) => (n > 0 ? '+' : '') + n.toFixed(2);

/** Count → share of the whole population (not just the rows shown). */
export const share = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

// ── Trend buckets ─────────────────────────────────────────────────────────────

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export type TrendGranularity = 'week' | 'month';

/** Weekly up to 90 days, monthly beyond. */
export const trendGranularity = (days: number): TrendGranularity => (days <= 90 ? 'week' : 'month');

/** Bucket key in IST: week = the Monday it starts (YYYY-MM-DD), month = YYYY-MM. */
export function bucketKey(date: Date | string, g: TrendGranularity): string {
  const ist = new Date(new Date(date).getTime() + IST_MS);
  if (g === 'month') return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - dow * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/** Every bucket from `from` to `to`, in order, so empty weeks / months show as zero. */
export function bucketRange(from: Date, to: Date, g: TrendGranularity): string[] {
  const keys: string[] = [];
  const end = bucketKey(to, g);
  let cursor = new Date(from);
  for (let guard = 0; guard < 1000; guard++) {
    const k = bucketKey(cursor, g);
    if (keys[keys.length - 1] !== k) keys.push(k);
    if (k === end) break;
    cursor = new Date(cursor.getTime() + (g === 'week' ? 7 : 28) * DAY_MS);
  }
  if (keys[keys.length - 1] !== end) keys.push(end);
  return keys;
}

/** Period from a ?days= query value, capped at two years. */
export function windowFrom(daysParam: unknown, fallback = 90): { days: number; from: Date } {
  const days = Math.min(Math.max(parseInt(String(daysParam), 10) || fallback, 1), 730);
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { days, from };
}
