import mongoose, { Document, Schema } from 'mongoose';

export const SAVING_GOAL_CATEGORIES = [
  'equipment', 'expansion', 'emergency', 'vehicle', 'inventory', 'tax', 'personal',
] as const;
export type SavingGoalCategory = (typeof SAVING_GOAL_CATEGORIES)[number];

export const SAVING_GOAL_PRIORITIES = ['high', 'medium', 'low'] as const;
export type SavingGoalPriority = (typeof SAVING_GOAL_PRIORITIES)[number];

export const SAVING_GOAL_STATUSES = ['active', 'completed', 'paused', 'cancelled'] as const;
export type SavingGoalStatus = (typeof SAVING_GOAL_STATUSES)[number];

export interface ISavingGoal extends Document {
  name: string;
  category: SavingGoalCategory;
  priority: SavingGoalPriority;
  targetAmount: number;
  savedAmount: number;
  targetDate?: Date;
  status: SavingGoalStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SavingGoalSchema = new Schema<ISavingGoal>(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, enum: SAVING_GOAL_CATEGORIES },
    priority: { type: String, required: true, enum: SAVING_GOAL_PRIORITIES, default: 'medium' },
    targetAmount: { type: Number, required: true, min: 1 },
    savedAmount: { type: Number, default: 0, min: 0 },
    targetDate: { type: Date },
    status: { type: String, enum: SAVING_GOAL_STATUSES, default: 'active' },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

SavingGoalSchema.index({ status: 1 });
SavingGoalSchema.index({ priority: 1 });

export const SavingGoal = mongoose.model<ISavingGoal>('SavingGoal', SavingGoalSchema);
