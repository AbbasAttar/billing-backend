import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { LENS_TYPES } from './LensPricing.model';

/**
 * A lens already cut (edged) for a frame that came back to the shop — customer didn't take it, frame
 * changed, remake — and can be refitted into a frame of the same or smaller size.
 * Kept apart from LensStock (uncut blanks) so billing, purchases and duplicate merges never touch it.
 * Unlike a blank, the axis is fixed and the size limits which frames it fits.
 */
export interface ICutLens extends BaseDoc {
  lensType: typeof LENS_TYPES[number];
  material: string;
  coating: string;
  color: string;
  sph: number;
  cyl: number;
  /** Fixed once cut; null when there is no CYL. */
  axis: number | null;
  add: number | null;
  /** Which eye it was cut for (matters for bifocal segment / progressive corridor). */
  eye: 'right' | 'left' | null;
  /** Free text: shape and size, e.g. "oval 50×32". */
  size: string;
  /** Where it came from, e.g. customer name or bill number. */
  source: string;
  notes: string;
  costPrice: number;
  status: 'available' | 'used';
  usedAt?: Date | null;
  usedNote?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const CutLens = createFirestoreModel<ICutLens>('cutlenses', { mirror: true });
