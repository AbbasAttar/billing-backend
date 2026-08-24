import mongoose, { Document, Schema } from 'mongoose';

export interface IDebtPayment extends Document {
  date: Date;
  debtId: string;
  creditor: string;
  amountPaid: number;
  notes?: string;
  createdAt: Date;
}

const DebtPaymentSchema = new Schema<IDebtPayment>(
  {
    date: { type: Date, required: true },
    debtId: { type: String, required: true, trim: true },
    creditor: { type: String, required: true, trim: true },
    amountPaid: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

DebtPaymentSchema.index({ debtId: 1 });
DebtPaymentSchema.index({ date: -1 });

export const DebtPayment = mongoose.model<IDebtPayment>('DebtPayment', DebtPaymentSchema);
