import mongoose, { Document, Schema } from 'mongoose';

export const DEBT_PRIORITIES = ['1-critical', '2-high', '3-normal', '4-low'] as const;
export type DebtPriority = (typeof DEBT_PRIORITIES)[number];

export const DEBT_STATUSES = ['open', 'paid'] as const;
export type DebtStatus = (typeof DEBT_STATUSES)[number];

export const DEBT_PAYMENT_TYPES = ['recurring-minimum', 'deadline-full'] as const;
export type DebtPaymentType = (typeof DEBT_PAYMENT_TYPES)[number];

export interface IDebt extends Document {
  debtId: string;
  creditor: string;
  originalAmount: number;
  alreadyPaid: number;
  priority: DebtPriority;
  dueDate?: Date;
  minimumPayment: number;
  notes?: string;
  status: DebtStatus;
  paymentType: DebtPaymentType;
  createdAt: Date;
  updatedAt: Date;
}

const DebtSchema = new Schema<IDebt>(
  {
    debtId: { type: String, required: true, unique: true, trim: true },
    creditor: { type: String, required: true, trim: true },
    originalAmount: { type: Number, required: true, min: 0 },
    alreadyPaid: { type: Number, default: 0, min: 0 },
    priority: { type: String, required: true, enum: DEBT_PRIORITIES, default: '3-normal' },
    dueDate: { type: Date },
    minimumPayment: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: DEBT_STATUSES, default: 'open' },
    paymentType: { type: String, enum: DEBT_PAYMENT_TYPES, required: true },
  },
  { timestamps: true }
);

DebtSchema.index({ status: 1 });
DebtSchema.index({ priority: 1 });

export const Debt = mongoose.model<IDebt>('Debt', DebtSchema);
