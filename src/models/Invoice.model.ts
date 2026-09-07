import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment {
  date: Date;
  amount: number;
  method: 'cash' | 'online';
  writeoff?: number;
}

export type AcquisitionSource =
  | 'google_maps'
  | 'instagram'
  | 'whatsapp'
  | 'referral'
  | 'doctor_rx'
  | 'walk_by'
  | 'flyers'
  | 'repeat'
  | 'other';

export interface IInvoice extends Document {
  customer: mongoose.Types.ObjectId;
  items: mongoose.Types.ObjectId[];
  subtotal: number;
  discount: number;
  total: number;
  mrpTotal?: number;
  storePriceTotal?: number;
  realDiscount?: number;
  payments: IPayment[];
  billDate: Date;
  billClearDate?: Date;
  invoiceNumber?: string;
  acquisitionSource?: AcquisitionSource;
  totalCogs?: number;
  packagingCost?: number;
  paymentProcessingFee?: number;
  netContributionMargin?: number;
  contributionMarginPct?: number;
  isNewCustomer?: boolean;
  visitNumber?: number;
}

const PaymentSchema = new Schema<IPayment>({
  date: { type: Date, required: true, default: Date.now },
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, required: true, enum: ['cash', 'online'], default: 'cash' },
  writeoff: { type: Number, default: 0, min: 0 },
});

const InvoiceSchema = new Schema<IInvoice>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    items: [{ type: Schema.Types.ObjectId, ref: 'InvoiceItem' }],
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    mrpTotal: { type: Number, default: null },
    storePriceTotal: { type: Number, default: null },
    realDiscount: { type: Number, default: 0 },
    payments: [PaymentSchema],
    billDate: { type: Date, required: true, default: Date.now },
    billClearDate: { type: Date },
    invoiceNumber: { type: String, default: null },
    acquisitionSource: {
      type: String,
      enum: ['google_maps', 'instagram', 'whatsapp', 'referral', 'doctor_rx', 'walk_by', 'flyers', 'repeat', 'other'],
      default: 'walk_by',
    },
    totalCogs: { type: Number, default: 0 },
    packagingCost: { type: Number, default: 0 },
    paymentProcessingFee: { type: Number, default: 0 },
    netContributionMargin: { type: Number, default: 0 },
    contributionMarginPct: { type: Number, default: 0 },
    isNewCustomer: { type: Boolean, default: true },
    visitNumber: { type: Number, default: 1 },
  },
  { timestamps: true }
);

InvoiceSchema.index({ customer: 1 });
InvoiceSchema.index({ billDate: -1 });
InvoiceSchema.index({ acquisitionSource: 1, billDate: -1 });
InvoiceSchema.index({ isNewCustomer: 1, billDate: -1 });

export const Invoice = mongoose.model<IInvoice>('Invoice', InvoiceSchema);
