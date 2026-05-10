import mongoose, { Document, Schema } from 'mongoose';

export const BILL_STATUSES = ['pending', 'partially_paid', 'paid', 'overdue'] as const;
export type BillStatus = typeof BILL_STATUSES[number];

export interface IVendorBill extends Document {
  vendorName: string;
  billDate: Date;
  dueDate: Date;
  totalAmount: number;
  paidAmount: number;
  status: BillStatus;
  category: string;
  note?: string;
  items: {
    description: string;
    amount: number;
  }[];
  payments: {
    amount: number;
    date: Date;
    method: string;
    note?: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const VendorBillSchema = new Schema<IVendorBill>(
  {
    vendorName: { type: String, required: true, trim: true },
    billDate: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date, required: true },
    totalAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: BILL_STATUSES, default: 'pending' },
    category: { type: String, required: true, default: 'stock' },
    note: { type: String, trim: true },
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
  },
  { timestamps: true }
);

VendorBillSchema.pre('save', function () {
  if (this.paidAmount >= this.totalAmount) {
    this.status = 'paid';
  } else if (this.paidAmount > 0) {
    this.status = 'partially_paid';
  } else if (this.dueDate < new Date() && this.status !== 'paid') {
    this.status = 'overdue';
  } else {
    this.status = 'pending';
  }
});

export const VendorBill = mongoose.model<IVendorBill>('VendorBill', VendorBillSchema);
