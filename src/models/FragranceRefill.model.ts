import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

/**
 * One refill of a fragrance (or one of its grades / sizes): how much was added, where it came from
 * (the shop's own wholesale stock, or bought outside) and what it cost. History only; the stock and
 * cost changes themselves are written on the fragrance.
 */
export interface IFragranceRefill extends BaseDoc {
  fragranceId: string;
  fragranceName: string;
  optionLabel?: string | null;
  /** Added, in the refilled product's stock unit. */
  qty: number;
  unit: string;
  source: 'wholesale' | 'outside';
  /** Wholesale product the stock was taken from (source "wholesale"). */
  fromFragranceId?: string | null;
  fromName?: string | null;
  fromOptionLabel?: string | null;
  /** Taken off the wholesale product, in its own stock unit. */
  fromQty?: number | null;
  fromUnit?: string | null;
  /** Taken more than the wholesale product had in stock (its stock stopped at 0). */
  shortBy?: number | null;
  /** Where it was bought (source "outside"). */
  supplier?: string | null;
  totalCost?: number | null;
  costPerUnit?: number | null;
  stockBefore: number;
  stockAfter: number;
  costBefore?: number | null;
  costAfter?: number | null;
  note?: string | null;
  by?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const FragranceRefill = createFirestoreModel<IFragranceRefill>('fragranceRefills');
