import mongoose, { Schema, Document } from 'mongoose';
import { IWebFields, WebFieldsSchema } from './webFields.schema';

export interface IContactLens extends Document {
  brand: string;
  name: string;
  lensType: 'daily' | 'monthly' | 'biweekly';
  packSize?: number;
  baseCurve?: string;
  diameter?: string;
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  web?: IWebFields;
}

const ContactLensSchema = new Schema<IContactLens>(
  {
    brand:     { type: String, required: true, trim: true },
    name:      { type: String, required: true, trim: true },
    lensType:  { type: String, required: true, enum: ['daily', 'monthly', 'biweekly'] },
    packSize:  { type: Number, min: 1 },
    baseCurve: { type: String, trim: true },
    diameter:  { type: String, trim: true },
    costPrice: { type: Number, min: 0 },
    sellPrice: { type: Number, min: 0 },
    stock:     { type: Number, min: 0, default: 0 },
    web: { type: WebFieldsSchema, default: () => ({ isPublished: false, images: [], tags: [], seo: {} }) },
  },
  { timestamps: true }
);

ContactLensSchema.index({ name: 'text', brand: 'text' });
ContactLensSchema.index({ 'web.slug': 1 }, { unique: true, sparse: true });
ContactLensSchema.index({ 'web.isPublished': 1, 'web.publishedAt': -1 });

export const ContactLens =
  (mongoose.models['ContactLens'] as mongoose.Model<IContactLens>) ||
  mongoose.model<IContactLens>('ContactLens', ContactLensSchema);
