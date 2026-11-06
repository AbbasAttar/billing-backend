import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import type { LensType, LensMaterial, LensColor } from './LensPricing.model';

/**
 * One price book per lens company: a base price per type × material plus add-ons per power band,
 * coating, tint and cross axis. Adding the parts prices any combination (see services/lensPriceResolver).
 * All amounts are per PAIR, like LensPricing. `sell` is optional — books in markup mode hold costs only.
 */
export interface PricePart {
  cost: number;
  sell?: number | null;
}

export interface BookBand extends PricePart {
  min: number;
  max: number;
}

export interface ILensPriceBook extends BaseDoc {
  company: string;
  bases: (PricePart & { lensType: LensType; material: LensMaterial })[];
  /** Signed: minus and plus powers are separate bands. Must cover the Rx SPH. */
  sphBands: BookBand[];
  /** By size, sign is notation only. Must cover the Rx CYL (enter 0..2 at cost 0 for the base band). */
  cylBands: BookBand[];
  /** Only used when the Rx has an ADD. */
  addBands: BookBand[];
  /** Also the list of coatings this company sells. */
  coatings: (PricePart & { coating: string })[];
  /** White needs no entry; other tints must be listed. */
  colors: (PricePart & { color: LensColor })[];
  crossAxis?: PricePart | null;
  effectiveDate?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const LensPriceBook = createFirestoreModel<ILensPriceBook>('lenspricebooks', { mirror: true });
