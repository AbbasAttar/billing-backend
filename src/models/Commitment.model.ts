import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface ICommitment extends BaseDoc {
  name: string;
  amount: number;
  dueDay?: number;
  isEssential: boolean;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Commitment = createFirestoreModel<ICommitment>('commitments');
