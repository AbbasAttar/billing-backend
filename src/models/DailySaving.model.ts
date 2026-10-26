import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

/** What the owner kept aside on one day: toward fixed costs and toward vendor payments. */
export interface IDailySaving extends BaseDoc {
  /** local day, YYYY-MM-DD; one entry per day */
  day: string;
  fixed: number;
  vendor: number;
  note?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DailySaving = createFirestoreModel<IDailySaving>('dailysavings', { mirror: true });
