/**
 * Lens stock moves for bill lines.
 *
 * Where a bill's lens came from (`LensSource`):
 *   counter  – taken off our own shelf: leaves lens stock
 *   ordered  – power sent to the wholesaler (lab queue)
 *   already  – already ordered elsewhere, skips the queue
 *   local    – bought from another local wholesaler for this bill
 * Only `counter` touches lens stock. A counter line records the stock rows it took in
 * `lensStockTaken`, so an edit or delete can put exactly those lenses back. Lines saved before
 * this record existed carry none, and nothing is put back for them (they never left stock).
 */
import type { ModelTx } from '../lib/firestoreModel';
import { LensStock } from '../models/LensStock.model';
import { toMinusCyl } from '../utils/lensPower';

export type LensSource = 'counter' | 'ordered' | 'already' | 'local';
export type LensTake = { row: string; qty: number };

/** Thrown when a counter line asks for a lens the shelf does not have. */
export class LensStockShortError extends Error {
  readonly status = 409;
}

/** Source picked in a create / edit request body. */
export function sourceFromBody(b: any): LensSource {
  if (b.fulfillmentSource === 'local') return 'local';
  if (b.alreadyOrdered || b.skipWholesalerQueue || b.fulfillmentSource === 'already_ordered') return 'already';
  if (b.fulfillmentSource === 'stock' && b.sendToWholesaler === false) return 'counter';
  return 'ordered';
}

/**
 * Source of a saved line. The lab queue also writes fulfillmentSource 'stock' when it marks a job
 * fitted (labFittedDate) or cancels it, so those are lab lines, not counter stock.
 */
export function sourceOfStored(i: any): LensSource {
  if (i.fulfillmentSource === 'local') return 'local';
  if (i.fulfillmentSource !== 'stock') return 'ordered';
  if (i.labFittedDate || i.labStatus === 'cancelled') return i.sentToWholesaler ? 'already' : 'ordered';
  return i.sentToWholesaler === false ? 'counter' : 'already';
}

/** Does the request body say anything about the source? (Older clients send nothing on edit.) */
export const bodyHasSource = (b: any) =>
  b.fulfillmentSource !== undefined || b.alreadyOrdered !== undefined || b.sendToWholesaler !== undefined || b.skipWholesalerQueue !== undefined;

/** Fields a line is saved with for a source. */
export function sourceFields(src: LensSource): Record<string, unknown> {
  switch (src) {
    case 'counter': return { fulfillmentSource: 'stock', sentToWholesaler: false, labStatus: 'fitted' };
    case 'already': return { fulfillmentSource: 'stock', sentToWholesaler: true, labStatus: 'fitted', wholesalerOrderDate: new Date() };
    case 'local':   return { fulfillmentSource: 'local', sentToWholesaler: false, labStatus: 'fitted' };
    default:        return { fulfillmentSource: 'ordered', sentToWholesaler: false, labStatus: 'pending' };
  }
}

export interface LensNeed {
  lensType: string;
  material: string;
  coating: string;
  color: string;
  sph: number;
  cyl: number;
  axis: number | null;
  add: number | null;
  eye: 'right' | 'left';
}

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();
const r2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const addOf = (v: unknown) => (typeof v === 'number' && v > 0 ? r2(v) : null);

/** One lens per eye the line covers, with the lens kind. Empty when the kind or power is missing. */
export function lensNeeds(item: any): LensNeed[] {
  const lensType = item.lensType ?? null;
  const material = item.lensMaterial ?? null;
  const coating = item.lensCoating ?? null;
  const color = item.lensColor ?? null;
  if (!lensType || !material || !coating || !color) return [];
  const eye = item.eye ?? 'both';
  const base = { lensType, material, coating, color };
  const out: LensNeed[] = [];
  if ((eye === 'right' || eye === 'both') && (item.rightSpherical ?? null) !== null) {
    out.push({ ...base, sph: item.rightSpherical, cyl: item.rightCylinder ?? 0, axis: item.rightAxis ?? null, add: item.rightAddition ?? null, eye: 'right' });
  }
  if ((eye === 'left' || eye === 'both') && (item.leftSpherical ?? null) !== null) {
    out.push({ ...base, sph: item.leftSpherical, cyl: item.leftCylinder ?? 0, axis: item.leftAxis ?? null, add: item.leftAddition ?? null, eye: 'left' });
  }
  return out;
}

/** Same lenses? Used to tell whether an edit changed what the line takes from stock. */
export const needsKey = (item: any) =>
  lensNeeds(item)
    .map((n) => {
      const p = toMinusCyl(r2(n.sph), r2(n.cyl), n.axis);
      return [lower(n.lensType), lower(n.material), lower(n.coating), lower(n.color), p.sph, p.cyl, p.axis ?? '', addOf(n.add) ?? '', n.eye].join('|');
    })
    .join(';');

/**
 * Does this stock row hold the lens? Names match ignoring case, powers are compared in minus cyl
 * (so a plus-cyl Rx finds its stock row), and ADD only counts off single vision.
 * Axis only has to agree when both the row and the bill have one: an uncut single-vision blank
 * turns to any axis, and older bifocal rows often have none recorded.
 */
export function stockRowFits(row: any, d: Omit<LensNeed, 'eye'>): boolean {
  if (lower(row.lensType) !== lower(d.lensType)) return false;
  if (lower(row.material) !== lower(d.material) || lower(row.coating) !== lower(d.coating) || lower(row.color) !== lower(d.color)) return false;
  const want = toMinusCyl(r2(d.sph), r2(d.cyl), d.axis);
  const have = toMinusCyl(r2(row.sph), r2(row.cyl), typeof row.axis === 'number' ? row.axis : null);
  if (want.sph !== have.sph || want.cyl !== have.cyl) return false;
  if (lower(d.lensType) !== 'single vision' && addOf(row.add) !== addOf(d.add)) return false;
  if (lower(d.lensType) !== 'single vision' && want.cyl !== 0 && typeof want.axis === 'number' && typeof have.axis === 'number') {
    const gap = Math.abs(want.axis - have.axis) % 180;
    if (Math.min(gap, 180 - gap) > 5) return false;
  }
  return true;
}

const fmt = (n: number) => (n === 0 ? '0.00' : `${n > 0 ? '+' : ''}${n.toFixed(2)}`);
const needText = (n: LensNeed) =>
  `${n.eye === 'right' ? 'RE' : 'LE'} ${fmt(r2(n.sph))}${r2(n.cyl) ? ` / ${fmt(r2(n.cyl))}` : ''}${addOf(n.add) ? ` add +${addOf(n.add)!.toFixed(2)}` : ''} · ${n.lensType} · ${n.material} · ${n.coating} · ${n.color}`;

/**
 * Stock changes for one transaction. All reads (`load`) come before `write`, as Firestore
 * transactions require; `take` / `give` only plan in memory.
 */
export class LensStockMoves {
  private rows = new Map<string, any>();
  private byType = new Map<string, any[]>();
  private delta = new Map<string, number>();

  constructor(private t: ModelTx) {}

  /** Reads the stock rows these lines may take from, and the rows earlier takes came from. */
  async load(takeFrom: any[], giveBack: LensTake[][]): Promise<void> {
    const types = new Set(takeFrom.flatMap((i) => lensNeeds(i).map((n) => n.lensType)));
    for (const type of types) {
      if (this.byType.has(type)) continue;
      const rows = await this.t.query<any>(LensStock, { lensType: type });
      rows.sort((a, b) => (a.id < b.id ? -1 : 1));
      this.byType.set(type, rows);
      for (const r of rows) this.rows.set(r.id, r);
    }
    const ids = [...new Set(giveBack.flat().map((g) => g.row))].filter((id) => !this.rows.has(id));
    if (ids.length) {
      const got = await this.t.getMany<any>(LensStock, ids);
      for (const [id, r] of got) if (r) this.rows.set(id, { ...r, id });
    }
  }

  private left(id: string): number {
    const q = this.rows.get(id)?.quantity;
    return (typeof q === 'number' ? q : 0) + (this.delta.get(id) ?? 0);
  }

  /** Takes one lens per eye for a counter line. Throws `LensStockShortError` naming what is missing. */
  take(item: any): LensTake[] {
    const needs = lensNeeds(item);
    if (!needs.length) {
      throw new LensStockShortError('Counter stock needs the lens type, material, coating, colour and power to find the lens on the shelf.');
    }
    const taken: LensTake[] = [];
    const missing: string[] = [];
    for (const n of needs) {
      const row = (this.byType.get(n.lensType) ?? []).find((r) => stockRowFits(r, n) && this.left(r.id) > 0);
      if (!row) { missing.push(needText(n)); continue; }
      this.delta.set(row.id, (this.delta.get(row.id) ?? 0) - 1);
      const got = taken.find((x) => x.row === row.id);
      if (got) got.qty += 1;
      else taken.push({ row: row.id, qty: 1 });
    }
    if (missing.length) {
      // Undo this line's partial take before failing.
      for (const x of taken) this.delta.set(x.row, (this.delta.get(x.row) ?? 0) + x.qty);
      throw new LensStockShortError(`Not in counter stock: ${missing.join('; ')}. Pick "Send to wholesaler" or "Sourced locally", or correct the count on Lens Stock.`);
    }
    return taken;
  }

  /** Puts lenses a line took back on the shelf (rows deleted since are skipped). */
  give(taken: LensTake[] | undefined | null): void {
    for (const x of taken ?? []) {
      if (!this.rows.has(x.row) || !(x.qty > 0)) continue;
      this.delta.set(x.row, (this.delta.get(x.row) ?? 0) + x.qty);
    }
  }

  async write(): Promise<void> {
    for (const [id, d] of this.delta) {
      if (!d) continue;
      await this.t.update(LensStock, id, { quantity: Math.max(0, this.left(id)) }, this.rows.get(id) ?? null);
    }
  }
}
