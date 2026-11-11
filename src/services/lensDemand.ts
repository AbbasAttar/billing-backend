/**
 * Per-power lens demand for the stock chart (Analytics → Lens → Stock chart: Sold / Buy modes).
 *
 * For each lens kind + power: lenses sold in the window, how many came off our shelf (counter)
 * versus from elsewhere (sent to the wholesaler, already ordered, bought locally), and lenses on
 * order (pending purchase entries not tied to a customer bill). All counts are pieces.
 * Powers are in minus cyl; single vision ignores ADD, like stock matching.
 */
import { eyeSales, hasLensKind, type LensLine } from './lensSales';
import { sourceOfStored } from './lensStockMoves';
import { toMinusCyl } from '../utils/lensPower';

export interface PowerDemand {
  lensType: string;
  material: string;
  coating: string;
  color: string;
  sph: number;
  cyl: number;
  add: number | null;
  /** Lenses sold in the window. */
  sold: number;
  /** Of those, taken off our shelf. */
  fromShelf: number;
  /** Of those, got elsewhere (wholesaler / local) — sales stock could have served. */
  elsewhere: number;
  /** Lenses on pending purchase entries. */
  onOrder: number;
}

export interface PendingPurchase {
  status?: string;
  importedFrom?: string | null;
  lensType?: string | null; material?: string | null; coating?: string | null; color?: string | null;
  eye?: string | null;
  sph?: number | null; cyl?: number | null; add?: number | null;
  qty?: number | null;
}

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();
const r2 = (n: number) => Math.round(n * 100) / 100;

const isSingleVision = (t: string) => lower(t) === 'single vision';

function addFor(lensType: string, add: number | null | undefined): number | null {
  if (isSingleVision(lensType)) return null;
  return typeof add === 'number' && add > 0 ? r2(add) : null;
}

/** Same key the frontend builds for a stock row (lib/lensDemand.ts demandKey). */
export function demandKey(d: { lensType: string; material: string; coating: string; color: string; sph: number; cyl: number; add: number | null }) {
  return [lower(d.lensType), lower(d.material), lower(d.coating), lower(d.color), r2(d.sph), r2(d.cyl), d.add ?? ''].join('|');
}

export function buildPowerDemand(lines: LensLine[], pending: PendingPurchase[]): PowerDemand[] {
  const map = new Map<string, PowerDemand>();
  const cell = (base: Omit<PowerDemand, 'sold' | 'fromShelf' | 'elsewhere' | 'onOrder'>) => {
    const k = demandKey(base);
    let c = map.get(k);
    if (!c) map.set(k, (c = { ...base, sold: 0, fromShelf: 0, elsewhere: 0, onOrder: 0 }));
    return c;
  };

  for (const it of lines) {
    if (!hasLensKind(it)) continue;
    const shelf = sourceOfStored(it) === 'counter';
    const lensType = String(it.lensType);
    for (const e of eyeSales(it)) {
      if (e.eye === 'single') continue;
      const c = cell({
        lensType, material: String(it.lensMaterial), coating: String(it.lensCoating ?? ''), color: String(it.lensColor ?? ''),
        sph: e.sph, cyl: e.cyl, add: addFor(lensType, e.add),
      });
      c.sold += e.pieces;
      if (shelf) c.fromShelf += e.pieces; else c.elsewhere += e.pieces;
    }
  }

  for (const p of pending) {
    // Lenses bought for a customer bill never reach the shelf.
    if (p.status !== 'pending' || p.importedFrom) continue;
    if (!p.lensType || !p.material || typeof p.sph !== 'number') continue;
    const power = toMinusCyl(r2(p.sph), r2(typeof p.cyl === 'number' ? p.cyl : 0), null);
    const qty = typeof p.qty === 'number' && p.qty > 0 ? p.qty : 0;
    const c = cell({
      lensType: p.lensType, material: p.material, coating: p.coating ?? '', color: p.color ?? '',
      sph: r2(power.sph) || 0, cyl: r2(power.cyl) || 0, add: addFor(p.lensType, p.add),
    });
    c.onOrder += p.eye === 'both' || !p.eye ? qty * 2 : qty;
  }

  return [...map.values()];
}
