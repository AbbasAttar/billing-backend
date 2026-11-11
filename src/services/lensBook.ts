/**
 * Lens book: lens sales copied from the old paper books (analytics only, never invoices).
 * Cleans one row from the entry page; returns an error message instead when it cannot be saved.
 */
import type { ILensBookEntry } from '../models/LensBookEntry.model';

export type LensBookInput = Omit<ILensBookEntry, 'id' | '_id' | 'createdAt' | 'updatedAt' | 'toObject' | 'toJSON' | 'customerId' | 'prescriptionId'>;

const text = (v: unknown, max = 120) => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
};

/** Number or null; '' and missing are null. Bad numbers return NaN so the caller can refuse them. */
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Same name the analytics use: the book's KT / Kryptok is the shop's Bifocal. */
function lensTypeName(v: unknown): string | null {
  const s = text(v, 60);
  if (!s) return null;
  const l = s.toLowerCase();
  if (l === 'sv' || l === 'single vision' || l === 'single') return 'Single Vision';
  if (l === 'kt' || l === 'bifocal' || l === 'kryptok' || l === 'kryptok bifocal') return 'Bifocal';
  if (l === 'pal' || l === 'progressive') return 'Progressive';
  return s;
}

/** Ten-digit mobile from what was typed (spaces, +91, dashes ignored); '' when empty; null when not a mobile. */
export function cleanPhone(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  if (!d) return '';
  const last10 = d.length >= 10 ? d.slice(-10) : '';
  return /^[6-9]\d{9}$/.test(last10) ? last10 : null;
}

const POWER_KEYS = ['rSph', 'rCyl', 'rAxis', 'rAdd', 'lSph', 'lCyl', 'lAxis', 'lAdd'] as const;
type PowerKey = (typeof POWER_KEYS)[number];

export function cleanLensBookRow(raw: Record<string, unknown>): { row: LensBookInput } | { error: string } {
  const date = raw.date ? new Date(String(raw.date)) : null;
  if (!date || Number.isNaN(date.getTime())) return { error: 'date is required' };
  if (date.getTime() > Date.now() + 86_400_000) return { error: 'date is in the future' };

  const lensType = lensTypeName(raw.lensType);
  if (!lensType) return { error: 'lens type is required' };

  const phone = cleanPhone(raw.phone);
  if (phone === null) return { error: 'mobile number must be 10 digits' };

  const sellPrice = numOrNull(raw.sellPrice);
  if (sellPrice === null || Number.isNaN(sellPrice) || sellPrice < 0) return { error: 'sell price must be 0 or more' };
  const buyPrice = numOrNull(raw.buyPrice);
  if (Number.isNaN(buyPrice as number) || (buyPrice !== null && buyPrice < 0)) return { error: 'buy price must be 0 or more' };

  const qtyRaw = numOrNull(raw.qty);
  const qty = qtyRaw === null ? 1 : qtyRaw;
  if (Number.isNaN(qty) || qty <= 0 || Math.round(qty * 2) !== qty * 2) return { error: 'quantity must be in half pairs (0.5, 1, 1.5…)' };

  const powers = {} as Record<PowerKey, number | null>;
  for (const k of POWER_KEYS) {
    const v = numOrNull(raw[k]);
    const eye = k[0] === 'r' ? 'RE' : 'LE';
    const name = k.slice(1).toUpperCase();
    if (Number.isNaN(v as number)) return { error: `${eye} ${name} is not a number` };
    if (v !== null && k.endsWith('Axis') && (v < 0 || v > 180)) return { error: `${eye} axis must be 0–180` };
    if (v !== null && !k.endsWith('Axis') && Math.abs(v) > 30) return { error: `${eye} ${name} is not a power` };
    powers[k] = v === null ? null : k.endsWith('Axis') ? Math.round(v) : r2(v);
  }
  for (const k of ['rAdd', 'lAdd'] as const) if (powers[k] !== null && (powers[k] as number) <= 0) powers[k] = null;

  return {
    row: {
      date,
      customer: text(raw.customer),
      phone: phone || null,
      lensType,
      material: text(raw.material, 40),
      coating: text(raw.coating, 40),
      color: text(raw.color, 40),
      index: text(raw.index, 10),
      details: text(raw.details),
      ...powers,
      qty,
      buyPrice: buyPrice === null ? null : r2(buyPrice),
      sellPrice: r2(sellPrice),
      notes: text(raw.notes, 300),
    },
  };
}

/** True when the row has any power for either eye. */
export const hasPower = (r: Partial<Record<PowerKey, number | null>>) =>
  POWER_KEYS.some((k) => !k.endsWith('Axis') && r[k] !== null && r[k] !== undefined);

// ── Bill lens lines shown in the Lens Book list (read-only) ─────────────────────

export interface BookListRow extends Partial<LensBookInput> {
  _id: string;
  source: 'book' | 'bill';
  date: Date;
  lensType: string;
  qty: number;
  sellPrice: number;
  buyPrice?: number | null;
  invoiceNumber?: string | null;
  customerId?: string | null;
  prescriptionId?: string | null;
}

const numOr = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * A bill's lens line in the Lens Book list's shape. Prices become per pair (line revenue ÷ pairs) so
 * pairs × price is what the line earned; a single-eye line is half a pair and shows only that eye.
 */
export function billLineToBookRow(
  it: any,
  inv: { billDate?: Date | string; createdAt?: Date | string; invoiceNumber?: string } | undefined,
  cust: { _id?: unknown; name?: string; mobileNumber?: string } | undefined,
  typeOf: (it: any) => string,
): BookListRow {
  const qtyUnits = typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1;
  const eye = it.eye === 'right' || it.eye === 'left' ? it.eye : 'both';
  const pairs = eye === 'both' ? qtyUnits : qtyUnits * 0.5;
  const revenue = (numOr(it.price) ?? 0) * qtyUnits;
  const cost = numOr(it.costPrice) && (it.costPrice as number) > 0 ? (it.costPrice as number) * qtyUnits : null;
  const r = eye !== 'left', l = eye !== 'right';
  const phone = String(cust?.mobileNumber ?? '').replace(/\D/g, '').slice(-10);
  const type = typeOf(it);
  return {
    _id: `bill:${String(it._id ?? it.id)}`,
    source: 'bill',
    date: new Date(inv?.billDate ?? it.createdAt ?? inv?.createdAt ?? Date.now()),
    customer: cust?.name ?? null,
    phone: phone || null,
    customerId: cust?._id ? String(cust._id) : null,
    invoiceNumber: inv?.invoiceNumber ?? null,
    lensType: type === 'Other' ? (it.lensType || it.lensCategory || it.lensName || 'Other') : type,
    material: it.lensMaterial ?? null,
    coating: it.lensCoating ?? null,
    color: it.lensColor ?? null,
    index: it.lensIndex ?? null,
    details: [it.lensBrand, it.lensName].filter(Boolean).join(' ') || null,
    rSph: r ? numOr(it.rightSpherical) : null, rCyl: r ? numOr(it.rightCylinder) : null,
    rAxis: r ? numOr(it.rightAxis) : null, rAdd: r ? numOr(it.rightAddition) : null,
    lSph: l ? numOr(it.leftSpherical) : null, lCyl: l ? numOr(it.leftCylinder) : null,
    lAxis: l ? numOr(it.leftAxis) : null, lAdd: l ? numOr(it.leftAddition) : null,
    qty: pairs,
    sellPrice: pairs > 0 ? Math.round(revenue / pairs) : 0,
    buyPrice: cost !== null && pairs > 0 ? Math.round(cost / pairs) : null,
  };
}
