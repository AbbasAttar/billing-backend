import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

/**
 * A lens sale copied from the old paper books. Never an invoice: no due, stock or cash. It may link
 * to a customer and a prescription saved from the entry page. Prices are per pair.
 */
export interface ILensBookEntry extends BaseDoc {
  date: Date;
  customer?: string | null;
  phone?: string | null;
  /** Customer record made or found from this line (only when asked to save the customer). */
  customerId?: string | null;
  /** Prescription saved from this line's powers. */
  prescriptionId?: string | null;
  /** Single Vision / Bifocal / Progressive / D-Bifocal, or what the book says. */
  lensType: string;
  material?: string | null;
  coating?: string | null;
  color?: string | null;
  index?: string | null;
  /** Spec as picked (e.g. "CR HC KT") plus any custom text. */
  details?: string | null;
  /** Right / left eye power, when the book has it. */
  rSph?: number | null; rCyl?: number | null; rAxis?: number | null; rAdd?: number | null;
  lSph?: number | null; lCyl?: number | null; lAxis?: number | null; lAdd?: number | null;
  /** Pairs (0.5 = one lens). */
  qty: number;
  /** What we paid, per pair. */
  buyPrice?: number | null;
  /** What the customer paid, per pair. */
  sellPrice: number;
  notes?: string | null;
}

export const LensBookEntry = createFirestoreModel<ILensBookEntry>('lensbook');
