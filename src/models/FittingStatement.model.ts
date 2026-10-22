import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

/** Snapshot of a job as it appears on the optician's statement (no cost/margin split). */
export interface FittingStatementLine {
  job: string;
  date: Date;
  patientName?: string;
  lensSpec: string;
  eye?: 'both' | 'right' | 'left';
  frameType?: string | null;
  reRx?: string;
  leRx?: string;
  quantity: number;
  lensAmount: number;
  fittingCharge: number;
  total: number;
}

/** Statement (invoice) sent to an optician for a batch of fitting jobs, settled in one payment. */
export interface IFittingStatement extends BaseDoc {
  number: string;
  seq: number;
  party: string | any;
  partyName: string;
  partyPhone?: string;
  issuedAt: Date;
  lines: FittingStatementLine[];
  total: number;
  status: 'unpaid' | 'paid';
  paidAt?: Date | null;
  paymentMethod?: string;
  paymentNote?: string;
  sentAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const FittingStatement = createFirestoreModel<IFittingStatement>('fittingstatements', { mirror: true });
