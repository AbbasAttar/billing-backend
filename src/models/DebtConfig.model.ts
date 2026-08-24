import mongoose, { Document, Schema } from 'mongoose';

export interface IDebtConfig extends Document {
  expectedShopIncome: number;
  otherIncome: number;
  safetyBuffer: number;
  createdAt: Date;
  updatedAt: Date;
}

const DebtConfigSchema = new Schema<IDebtConfig>(
  {
    expectedShopIncome: { type: Number, default: 0, min: 0 },
    otherIncome: { type: Number, default: 0, min: 0 },
    safetyBuffer: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export const DebtConfig = mongoose.model<IDebtConfig>('DebtConfig', DebtConfigSchema);
