import mongoose, { Document, Schema } from 'mongoose';

export interface IMonthlyTarget extends Document {
  month: string; // YYYY-MM
  revenueTarget: number;
  expenseBudget: number;
  personalBudget: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const MonthlyTargetSchema = new Schema<IMonthlyTarget>(
  {
    month: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}$/ },
    revenueTarget: { type: Number, required: true, min: 0 },
    expenseBudget: { type: Number, required: true, min: 0 },
    personalBudget: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

MonthlyTargetSchema.index({ month: -1 });

export const MonthlyTarget = mongoose.model<IMonthlyTarget>('MonthlyTarget', MonthlyTargetSchema);
