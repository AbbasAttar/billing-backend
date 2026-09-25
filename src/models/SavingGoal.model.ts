import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export const SAVING_GOAL_CATEGORIES = [
  'equipment', 'expansion', 'emergency', 'vehicle', 'inventory', 'tax', 'personal',
] as const;
export type SavingGoalCategory = (typeof SAVING_GOAL_CATEGORIES)[number];

export const SAVING_GOAL_PRIORITIES = ['high', 'medium', 'low'] as const;
export type SavingGoalPriority = (typeof SAVING_GOAL_PRIORITIES)[number];

export const SAVING_GOAL_STATUSES = ['active', 'completed', 'paused', 'cancelled'] as const;
export type SavingGoalStatus = (typeof SAVING_GOAL_STATUSES)[number];

export interface ISavingGoal extends BaseDoc {
  name: string;
  category: SavingGoalCategory;
  priority: SavingGoalPriority;
  targetAmount: number;
  savedAmount: number;
  targetDate?: Date;
  status: SavingGoalStatus;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const SavingGoal = createFirestoreModel<ISavingGoal>('savinggoals');
