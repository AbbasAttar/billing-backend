import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoiceItem extends Document {
  frame?: mongoose.Types.ObjectId;
  opticalLens?: mongoose.Types.ObjectId;
  fragrance?: mongoose.Types.ObjectId;
  quantity: number;
  price: number;
}

const InvoiceItemSchema = new Schema<IInvoiceItem>(
  {
    frame: { type: Schema.Types.ObjectId, ref: 'Frame' },
    opticalLens: { type: Schema.Types.ObjectId, ref: 'OpticalNumber' },
    fragrance: { type: Schema.Types.ObjectId, ref: 'Fragrance' },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

export const InvoiceItem = mongoose.model<IInvoiceItem>('InvoiceItem', InvoiceItemSchema);
