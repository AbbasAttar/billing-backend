import mongoose, { Schema, Document } from 'mongoose';

export type RequirementCategory = 'frame' | 'opticalLens' | 'contactLens' | 'fragrance' | 'accessory' | 'other';
export type RequirementStatus = 'pending' | 'ordered' | 'arrived' | 'fulfilled' | 'cancelled';
export type RequirementUrgency = 'urgent' | 'normal' | 'low';

export interface ICustomerRequirement extends Document {
  date: Date;
  customer?: mongoose.Types.ObjectId;
  customerName: string;
  customerMobile: string;
  customerCity?: string;
  category: RequirementCategory;
  title: string;
  brand?: string;
  modelNumber?: string;
  color?: string;
  specifications?: string;
  estimatedPrice?: number;
  urgency: RequirementUrgency;
  status: RequirementStatus;
  notes?: string;
  vendorNotes?: string;
  arrivedDate?: Date;
  fulfilledDate?: Date;
  convertedInvoiceId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerRequirementSchema = new Schema<ICustomerRequirement>(
  {
    date: { type: Date, required: true, default: Date.now },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: { type: String, required: true, trim: true },
    customerMobile: { type: String, required: true, trim: true },
    customerCity: { type: String, trim: true },
    category: {
      type: String,
      enum: ['frame', 'opticalLens', 'contactLens', 'fragrance', 'accessory', 'other'],
      required: true,
      default: 'frame',
    },
    title: { type: String, required: true, trim: true },
    brand: { type: String, trim: true },
    modelNumber: { type: String, trim: true },
    color: { type: String, trim: true },
    specifications: { type: String, trim: true },
    estimatedPrice: { type: Number, min: 0 },
    urgency: {
      type: String,
      enum: ['urgent', 'normal', 'low'],
      default: 'normal',
    },
    status: {
      type: String,
      enum: ['pending', 'ordered', 'arrived', 'fulfilled', 'cancelled'],
      default: 'pending',
    },
    notes: { type: String, trim: true },
    vendorNotes: { type: String, trim: true },
    arrivedDate: { type: Date },
    fulfilledDate: { type: Date },
    convertedInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  },
  { timestamps: true }
);

export const CustomerRequirement = mongoose.model<ICustomerRequirement>(
  'CustomerRequirement',
  CustomerRequirementSchema
);
