import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

/**
 * An optician or doctor we fit lenses for (side business). We source the lens, fit it into their
 * frame, run up an account and bill them once it crosses `billThreshold`.
 */
export interface IFittingParty extends BaseDoc {
  name: string;
  shopName?: string;
  phone?: string;
  city?: string;
  notes?: string;
  billThreshold: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DEFAULT_FITTING_BILL_THRESHOLD = 5000;

export const FittingParty = createFirestoreModel<IFittingParty>('fittingparties', { mirror: true });
