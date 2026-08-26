import mongoose, { Document, Schema } from 'mongoose';

export const CASHFLOW_TYPES = ['expense', 'payable'] as const;
export type CashflowType = typeof CASHFLOW_TYPES[number];

export const CASHFLOW_CATEGORIES = [
  'rent',
  'salary',
  'utilities',
  'stock',
  'maintenance',
  'transport',
  'marketing',
  'miscellaneous',
] as const;
export type CashflowCategory = typeof CASHFLOW_CATEGORIES[number];

export const CASHFLOW_PAYMENT_METHODS = [
  'cash',
  'upi',
  'card',
  'bank_transfer',
  'bank transfer',
  'cheque',
  'online',
  'other',
] as const;
export type CashflowPaymentMethod = (typeof CASHFLOW_PAYMENT_METHODS)[number];

export function normalizePaymentMethod(method?: string): CashflowPaymentMethod {
  if (!method) return 'cash';
  const m = method.trim().toLowerCase().replace(/\s+/g, '_');
  if (m === 'bank_transfer' || m === 'bank' || m === 'neft' || m === 'rtgs' || m === 'imps' || m === 'transfer') return 'bank_transfer';
  if (m === 'upi' || m === 'gpay' || m === 'phonepe' || m === 'paytm') return 'upi';
  if (m === 'card' || m === 'credit_card' || m === 'debit_card') return 'card';
  if (m === 'cheque' || m === 'check') return 'cheque';
  if (m === 'online' || m === 'netbanking') return 'bank_transfer';
  if (m === 'cash') return 'cash';
  return 'other';
}

export const CASHFLOW_STATUSES = ['logged', 'void', 'pending', 'partially_paid', 'paid', 'overdue'] as const;
export type CashflowStatus = typeof CASHFLOW_STATUSES[number];

export interface ICashflow extends Document {
  type: CashflowType;
  date: Date;
  dueDate?: Date;
  amount: number;
  paidAmount: number;
  status: CashflowStatus;
  category: string;
  vendorName?: string;
  note?: string;
  paymentMethod?: string;
  voidReason?: string;
  items: { description: string; amount: number }[];
  payments: { amount: number; date: Date; method: string; note?: string }[];
  obligationId?: mongoose.Types.ObjectId;
  obligationPaymentId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CashflowSchema = new Schema<ICashflow>(
  {
    type: { type: String, required: true, enum: CASHFLOW_TYPES },
    date: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date },
    amount: { type: Number, required: true, min: 0.01 },
    paidAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: CASHFLOW_STATUSES, default: 'logged' },
    category: { type: String, required: true },
    vendorName: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 300 },
    paymentMethod: { type: String, enum: CASHFLOW_PAYMENT_METHODS },
    voidReason: { type: String, trim: true },
    items: [
      {
        description: { type: String, required: true },
        amount: { type: Number, required: true },
      },
    ],
    payments: [
      {
        amount: { type: Number, required: true },
        date: { type: Date, required: true, default: Date.now },
        method: { type: String, required: true },
        note: { type: String },
      },
    ],
    obligationId: { type: Schema.Types.ObjectId, ref: 'Obligation' },
    obligationPaymentId: { type: Schema.Types.ObjectId, ref: 'ObligationPayment' },
  },
  { timestamps: true }
);

// Auto-compute status for payable entries on every save
CashflowSchema.pre('save', function () {
  if (this.type === 'payable') {
    if (this.paidAmount >= this.amount) {
      this.status = 'paid';
    } else if (this.paidAmount > 0) {
      this.status = 'partially_paid';
    } else if (this.dueDate && this.dueDate < new Date() && this.status !== 'paid') {
      this.status = 'overdue';
    } else {
      this.status = 'pending';
    }
  }
});

CashflowSchema.index({ date: -1 });
CashflowSchema.index({ type: 1, status: 1 });
CashflowSchema.index({ category: 1 });
CashflowSchema.index({ obligationId: 1 });
CashflowSchema.index({ obligationPaymentId: 1 });

export const Cashflow = mongoose.model<ICashflow>('Cashflow', CashflowSchema);
