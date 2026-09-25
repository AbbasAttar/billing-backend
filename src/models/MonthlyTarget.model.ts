import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IMonthlyTarget extends BaseDoc {
  month: string; // YYYY-MM
  revenueTarget: number;
  expenseBudget: number;
  personalBudget: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const MonthlyTarget = createFirestoreModel<IMonthlyTarget>('monthlytargets');
