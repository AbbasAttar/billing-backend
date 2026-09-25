import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const SAVING_TRANSACTION_TYPES = ['deposit', 'withdrawal', 'adjustment'] as const;
export type SavingTransactionType = (typeof SAVING_TRANSACTION_TYPES)[number];

export interface ISavingTransaction extends BaseDoc {
  goalId: string | any;
  type: SavingTransactionType;
  amount: number;
  date: Date;
  method?: string;
  reference?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const SavingTransaction = createFirestoreModel<ISavingTransaction>('savingtransactions');
