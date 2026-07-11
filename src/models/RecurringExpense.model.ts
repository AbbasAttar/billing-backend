import mongoose, { Document, Schema } from 'mongoose';

export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const RECURRING_CATEGORIES = [
  'rent', 'electricity', 'salary', 'internet', 'stationery', 'packaging',
  'marketing', 'repairs', 'transportation', 'bank_charges', 'qurdan',
  'taxes', 'insurance', 'professional', 'miscellaneous',
] as const;
export type RecurringCategory = (typeof RECURRING_CATEGORIES)[number];

export interface IRecurringDeposit {
  _id: mongoose.Types.ObjectId;
  amount: number;
  date: Date;
  method?: string;
  note?: string;
}

export interface IRecurringExpense extends Document {
  name: string;
  category: string;
  amount: number;
  frequency: RecurringFrequency;
  dayOfMonth?: number;        // 1-31, used when frequency = monthly
  nextDueDate: Date;
  reminderDays: number;       // show alert this many days before due
  autoGenerate: boolean;      // auto-create cashflow entry when due
  autoMarkPaid: boolean;      // mark as paid automatically
  paymentMethod?: string;
  vendorName?: string;
  notes?: string;
  isActive: boolean;
  deposits: IRecurringDeposit[];
  prepaidAmount: number;      // running total of deposits not yet applied to a generated entry
  createdAt: Date;
  updatedAt: Date;
}

const DepositSchema = new Schema<IRecurringDeposit>(
  {
    amount: { type: Number, required: true, min: 0.01 },
    date:   { type: Date,   required: true, default: Date.now },
    method: { type: String },
    note:   { type: String, trim: true },
  },
  { _id: true }
);

const RecurringExpenseSchema = new Schema<IRecurringExpense>(
  {
    name:          { type: String, required: true, trim: true },
    category:      { type: String, required: true, trim: true },
    amount:        { type: Number, required: true, min: 0.01 },
    frequency:     { type: String, required: true, enum: RECURRING_FREQUENCIES },
    dayOfMonth:    { type: Number, min: 1, max: 31 },
    nextDueDate:   { type: Date, required: true },
    reminderDays:  { type: Number, default: 3, min: 0, max: 30 },
    autoGenerate:  { type: Boolean, default: false },
    autoMarkPaid:  { type: Boolean, default: false },
    paymentMethod: { type: String },
    vendorName:    { type: String, trim: true },
    notes:         { type: String, trim: true, maxlength: 300 },
    isActive:      { type: Boolean, default: true },
    deposits:      { type: [DepositSchema], default: [] },
    prepaidAmount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

RecurringExpenseSchema.index({ nextDueDate: 1, isActive: 1 });

export const RecurringExpense = mongoose.model<IRecurringExpense>('RecurringExpense', RecurringExpenseSchema);
