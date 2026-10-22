import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const FITTING_JOB_STATUSES = ['ordered', 'ready', 'delivered', 'cancelled'] as const;
export type FittingJobStatus = (typeof FITTING_JOB_STATUSES)[number];

/** Frame the lens is fitted into: full rim, supra (half rim) or 3 piece (rimless, drilled). Defaults to full. */
export const FITTING_FRAME_TYPES = ['full', 'supra', '3piece'] as const;
export type FittingFrameType = (typeof FITTING_FRAME_TYPES)[number];

/**
 * One lens-fitting job for an optician (FittingParty): the lens we order from the wholesaler plus
 * what we charge for it. total = lensCharge + fittingCharge. lensCost (what the wholesaler bills us)
 * is ours only; margin = lensCharge - lensCost is kept for analytics.
 */
export interface IFittingJob extends BaseDoc {
  party: string | any;
  partyName: string;
  date: Date;
  patientName?: string;
  frameNote?: string;
  frameType?: FittingFrameType | null;
  /** Wholesale order slip text as sent to the lab, kept for the statement. */
  lensSpec: string;
  /** both eyes, or a single lens (half pair) for one eye. */
  eye: 'both' | 'right' | 'left';
  reRx?: string;
  leRx?: string;
  quantity: number;
  lensCost: number;
  lensCharge: number;
  margin: number;
  fittingCharge: number;
  total: number;
  status: FittingJobStatus;
  /** Lab-queue line (InvoiceItem) created when the lens was ordered. */
  labItem?: string | null;
  billed: boolean;
  statement?: string | null;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Total billed to the optician and our lens margin, from the three charge fields. */
export const fittingJobAmounts = (j: { lensCost?: number; lensCharge?: number; fittingCharge?: number }) => {
  const lensCost = Math.round(Number(j.lensCost) || 0);
  const lensCharge = Math.round(Number(j.lensCharge) || 0);
  const fittingCharge = Math.round(Number(j.fittingCharge) || 0);
  return { lensCost, lensCharge, fittingCharge, margin: lensCharge - lensCost, total: lensCharge + fittingCharge };
};

export const FittingJob = createFirestoreModel<IFittingJob>('fittingjobs', { mirror: true });
