import mongoose, { Document, Schema } from 'mongoose';

export const PERSONAL_EXPENSE_CATEGORIES = [
  'ration',
  'utilities',
  'medicine',
  'emi',
  'school',
  'fuel',
  'travel',
  'entertainment',
  'insurance',
  'maintenance',
  'miscellaneous',
] as const;

export const PERSONAL_PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer'] as const;

export type PersonalExpenseCategory = typeof PERSONAL_EXPENSE_CATEGORIES[number];
export type PersonalPaymentMethod = typeof PERSONAL_PAYMENT_METHODS[number];

export interface IPersonalExpense extends Document {
  date: Date;
  amount: number;
  category: PersonalExpenseCategory;
  note?: string;
  paymentMethod: PersonalPaymentMethod;
  isRecurring: boolean;
  recurringDay?: number;
  createdAt: Date;
  updatedAt: Date;
}

const PersonalExpenseSchema = new Schema<IPersonalExpense>(
  {
    date: { type: Date, required: true, default: Date.now },
    amount: { type: Number, required: true, min: 0.01 },
    category: { type: String, required: true, enum: PERSONAL_EXPENSE_CATEGORIES },
    note: { type: String, trim: true, maxlength: 300 },
    paymentMethod: { type: String, required: true, enum: PERSONAL_PAYMENT_METHODS, default: 'cash' },
    isRecurring: { type: Boolean, default: false },
    recurringDay: { type: Number, min: 1, max: 31 },
  },
  { timestamps: true }
);

PersonalExpenseSchema.index({ date: -1 });
PersonalExpenseSchema.index({ category: 1 });

export const PersonalExpense = mongoose.model<IPersonalExpense>('PersonalExpense', PersonalExpenseSchema);
