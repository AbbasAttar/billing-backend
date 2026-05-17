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
  // Lens product fields — denormalized
  lensBrand?: string;
  lensName?: string;
  lensCategory?: string;
  lensIndex?: string;
  lensCoating?: string;
  // Simplified Prescription
  rightEyeNumber?: string;
  leftEyeNumber?: string;
  lensCompany?: string;
  lensType?: string;
  isSameNumber?: boolean;
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
    quantity: { type: Number, required: true, min: 0.0001 },
    price: { type: Number, required: true, min: 0 },
    // Lens product fields
    lensBrand: { type: String, default: null },
    lensName: { type: String, default: null },
    lensCategory: { type: String, default: null },
    lensIndex: { type: String, default: null },
    lensCoating: { type: String, default: null },
    // Simplified Prescription
    rightEyeNumber: { type: String, default: null },
    leftEyeNumber: { type: String, default: null },
    lensCompany: { type: String, default: null },
    lensType: { type: String, default: null },
    isSameNumber: { type: Boolean, default: false },
  },
  { timestamps: true }
);

InvoiceItemSchema.path('frame').validate(function (this: IInvoiceItem) {
  const refs = [this.frame, this.opticalLens, this.fragrance].filter(Boolean);
  return refs.length === 1;
}, 'Each invoice item must reference exactly one of: frame, opticalLens, fragrance');

export const InvoiceItem = mongoose.model<IInvoiceItem>('InvoiceItem', InvoiceItemSchema);
