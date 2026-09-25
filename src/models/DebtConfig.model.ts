import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IDebtConfig extends BaseDoc {
  expectedShopIncome: number;
  otherIncome: number;
  safetyBuffer: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const DebtConfig = createFirestoreModel<IDebtConfig>('debtconfigs');
