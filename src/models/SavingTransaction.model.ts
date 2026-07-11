import mongoose, { Document, Schema } from 'mongoose';

export const SAVING_TRANSACTION_TYPES = ['deposit', 'withdrawal', 'adjustment'] as const;
export type SavingTransactionType = (typeof SAVING_TRANSACTION_TYPES)[number];

export interface ISavingTransaction extends Document {
  goalId: mongoose.Types.ObjectId;
  type: SavingTransactionType;
  amount: number;
  date: Date;
  method?: string;
  reference?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SavingTransactionSchema = new Schema<ISavingTransaction>(
  {
    goalId: { type: Schema.Types.ObjectId, ref: 'SavingGoal', required: true },
    type: { type: String, required: true, enum: SAVING_TRANSACTION_TYPES },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, required: true, default: Date.now },
    method: { type: String, trim: true },
    reference: { type: String, trim: true },
    notes: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

SavingTransactionSchema.index({ goalId: 1, date: -1 });

export const SavingTransaction = mongoose.model<ISavingTransaction>('SavingTransaction', SavingTransactionSchema);
