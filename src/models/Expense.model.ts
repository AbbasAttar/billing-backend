import mongoose, { Document, Schema } from 'mongoose';

export const EXPENSE_CATEGORIES = [
  'rent',
  'salary',
  'utilities',
  'stock',
  'maintenance',
  'transport',
  'marketing',
  'miscellaneous',
] as const;

export const EXPENSE_PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank_transfer'] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export type ExpensePaymentMethod = typeof EXPENSE_PAYMENT_METHODS[number];

export interface IExpense extends Document {
  date: Date;
  amount: number;
  category: ExpenseCategory;
  note?: string;
  vendorName?: string;
  paymentMethod: ExpensePaymentMethod;
  isVoid: boolean;
  voidReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    date: { type: Date, required: true, default: Date.now },
    amount: { type: Number, required: true, min: 0.01 },
    category: { type: String, required: true, enum: EXPENSE_CATEGORIES },
    note: { type: String, trim: true, maxlength: 300 },
    vendorName: { type: String, trim: true },
    paymentMethod: { type: String, required: true, enum: EXPENSE_PAYMENT_METHODS, default: 'cash' },
    isVoid: { type: Boolean, default: false },
    voidReason: { type: String, trim: true },
  },
  { timestamps: true }
);

ExpenseSchema.index({ date: -1 });
ExpenseSchema.index({ category: 1 });

ExpenseSchema.pre('validate', function (next) {
  if (this.isVoid && !this.voidReason?.trim()) {
    next(new Error('voidReason is required when isVoid is true'));
    return;
  }
  next();
});

export const Expense = mongoose.model<IExpense>('Expense', ExpenseSchema);
