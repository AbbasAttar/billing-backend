import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoiceItem extends Document {
  frame?: mongoose.Types.ObjectId;
  opticalLens?: mongoose.Types.ObjectId;
  prescription?: mongoose.Types.ObjectId;
  fragrance?: mongoose.Types.ObjectId;
  eye?: 'left' | 'right' | 'both';
  userName?: string;
  spherical?: number;
  cylinder?: number;
  axis?: number;
  addition?: number;
  lensLabel?: string;
  quantity: number;
  price: number;
}

const InvoiceItemSchema = new Schema<IInvoiceItem>(
  {
    frame: { type: Schema.Types.ObjectId, ref: 'Frame' },
    opticalLens: { type: Schema.Types.ObjectId, ref: 'OpticalLens' },
    prescription: { type: Schema.Types.ObjectId, ref: 'Prescription' },
    fragrance: { type: Schema.Types.ObjectId, ref: 'Fragrance' },
    eye: { type: String, enum: ['left', 'right', 'both'], required: false },
    userName: { type: String, default: null },
    spherical: { type: Number, default: null },
    cylinder: { type: Number, default: null },
    axis: { type: Number, default: null },
    addition: { type: Number, default: null },
    lensLabel: { type: String, default: null },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

export const InvoiceItem = mongoose.model<IInvoiceItem>('InvoiceItem', InvoiceItemSchema);

