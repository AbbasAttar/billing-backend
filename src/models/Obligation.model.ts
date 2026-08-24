import mongoose, { Document, Schema } from 'mongoose';

export const OBLIGATION_CATEGORIES = ['vendor', 'personal', 'loan', 'other'] as const;
export type ObligationCategory = (typeof OBLIGATION_CATEGORIES)[number];

export const OBLIGATION_PRIORITIES = ['1-critical', '2-high', '3-normal', '4-low'] as const;
export type ObligationPriority = (typeof OBLIGATION_PRIORITIES)[number];

export const OBLIGATION_STATUSES = ['open', 'paid'] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export interface IObligationItem {
  description: string;
  amount: number;
}

export interface IObligation extends Document {
  creditor: string;
  category: ObligationCategory;
  subcategory?: string;         // vendor bill category (stock, utilities, etc.)
  originalAmount: number;
  alreadyPaid: number;
  priority: ObligationPriority;
  dueDate?: Date;
  billDate?: Date;
  minPayment: number;           // minimum monthly / recurring payment
  isRecurring: boolean;         // resets each month after full payment
  dueDay?: number;              // day of month (1-31) for recurring obligations
  notes?: string;
  status: ObligationStatus;
  items: IObligationItem[];
  migratedFrom?: 'VendorBill' | 'Debt';
  createdAt: Date;
  updatedAt: Date;
}

const ObligationSchema = new Schema<IObligation>(
  {
    creditor:        { type: String, required: true, trim: true },
    category:        { type: String, required: true, enum: OBLIGATION_CATEGORIES, default: 'other' },
    subcategory:     { type: String, trim: true },
    originalAmount:  { type: Number, required: true, min: 0 },
    alreadyPaid:     { type: Number, default: 0, min: 0 },
    priority:        { type: String, required: true, enum: OBLIGATION_PRIORITIES, default: '3-normal' },
    dueDate:         { type: Date },
    billDate:        { type: Date },
    minPayment:      { type: Number, default: 0, min: 0 },
    isRecurring:     { type: Boolean, default: false },
    dueDay:          { type: Number, min: 1, max: 31 },
    notes:           { type: String, trim: true, maxlength: 500 },
    status:          { type: String, enum: OBLIGATION_STATUSES, default: 'open' },
    items:           [{ description: { type: String, required: true }, amount: { type: Number, required: true } }],
    migratedFrom:    { type: String, enum: ['VendorBill', 'Debt'] },
  },
  { timestamps: true }
);

ObligationSchema.index({ status: 1 });
ObligationSchema.index({ category: 1 });
ObligationSchema.index({ priority: 1 });
ObligationSchema.index({ dueDate: 1 });

export const Obligation = mongoose.model<IObligation>('Obligation', ObligationSchema);
