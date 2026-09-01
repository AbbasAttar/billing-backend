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
  mrp?: number;
  storePrice?: number;
  tier?: string;
  // Lens product fields — denormalized
  lensBrand?: string;
  lensName?: string;
  lensCategory?: string;
  lensIndex?: string;
  lensCoating?: string;
  // Frame variant (color) selection
  frameVariantLabel?: string;
  // Simplified Prescription (legacy string format)
  rightEyeNumber?: string;
  leftEyeNumber?: string;
  lensCompany?: string;
  lensType?: string;
  lensMaterial?: string;
  lensColor?: string;
  isCustomLens?: boolean;
  isSameNumber?: boolean;
  // Fulfillment tracking
  fulfillmentSource: 'stock' | 'ordered' | 'unfulfilled';
  requestedQty?: number | null;
  fulfilledQty?: number | null;
  sentToWholesaler?: boolean;
  wholesalerOrderDate?: Date | null;
  // Structured prescription fields
  rightSpherical?: number | null;
  rightCylinder?: number | null;
  rightAxis?: number | null;
  rightAddition?: number | null;
  leftSpherical?: number | null;
  leftCylinder?: number | null;
  leftAxis?: number | null;
  leftAddition?: number | null;
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
    mrp: { type: Number, default: null },
    storePrice: { type: Number, default: null },
    tier: { type: String, default: null },
    // Lens product fields
    lensBrand: { type: String, default: null },
    lensName: { type: String, default: null },
    lensCategory: { type: String, default: null },
    lensIndex: { type: String, default: null },
    lensCoating: { type: String, default: null },
    // Frame variant colour
    frameVariantLabel: { type: String, default: null },
    // Simplified Prescription (legacy string format)
    rightEyeNumber: { type: String, default: null },
    leftEyeNumber: { type: String, default: null },
    lensCompany: { type: String, default: null },
    lensType: { type: String, default: null },
    lensMaterial: { type: String, default: null },
    lensColor: { type: String, default: null },
    isCustomLens: { type: Boolean, default: false },
    isSameNumber: { type: Boolean, default: false },
    // Fulfillment tracking
    fulfillmentSource: { type: String, enum: ['stock', 'ordered', 'unfulfilled'], required: true, default: 'stock' },
    requestedQty: { type: Number, default: null },
    fulfilledQty: { type: Number, default: null },
    sentToWholesaler: { type: Boolean, default: false },
    wholesalerOrderDate: { type: Date, default: null },
    // Structured prescription fields
    rightSpherical: { type: Number, default: null },
    rightCylinder: { type: Number, default: null },
    rightAxis: { type: Number, default: null },
    rightAddition: { type: Number, default: null },
    leftSpherical: { type: Number, default: null },
    leftCylinder: { type: Number, default: null },
    leftAxis: { type: Number, default: null },
    leftAddition: { type: Number, default: null },
  },
  { timestamps: true }
);

InvoiceItemSchema.path('frame').validate(function (this: IInvoiceItem) {
  const refs = [this.frame, this.opticalLens, this.fragrance].filter(Boolean);
  if (this.fulfillmentSource === 'unfulfilled') return refs.length <= 1;
  return refs.length === 1;
}, 'Each invoice item must reference exactly one of: frame, opticalLens, fragrance');

export const InvoiceItem = mongoose.model<IInvoiceItem>('InvoiceItem', InvoiceItemSchema);
