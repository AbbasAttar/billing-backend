import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment {
  date: Date;
  amount: number;
  method: 'cash' | 'online';
}

export interface IInvoice extends Document {
  customer: mongoose.Types.ObjectId;
  items: mongoose.Types.ObjectId[];
  subtotal: number;
  discount: number;
  total: number;
  payments: IPayment[];
  billDate: Date;
  billClearDate?: Date;
}

const PaymentSchema = new Schema<IPayment>({
  date: { type: Date, required: true, default: Date.now },
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, required: true, enum: ['cash', 'online'] },
});

const InvoiceSchema = new Schema<IInvoice>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    items: [{ type: Schema.Types.ObjectId, ref: 'InvoiceItem' }],
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    payments: [PaymentSchema],
    billDate: { type: Date, required: true, default: Date.now },
    billClearDate: { type: Date },
  },
  { timestamps: true }
);

InvoiceSchema.index({ customer: 1 });
InvoiceSchema.index({ billDate: -1 });

export const Invoice = mongoose.model<IInvoice>('Invoice', InvoiceSchema);
