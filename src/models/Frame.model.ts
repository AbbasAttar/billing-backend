import mongoose, { Schema, Document } from 'mongoose';
import { IWebFields, WebFieldsSchema } from './webFields.schema';

export interface IFrame extends Document {
  companyName: string;
  name: string;
  houseName?: string;
  type?: string;
  costPrice?: number;
  sellPrice?: number;
  mrp?: number;
  tier?: 'essential' | 'trendy' | 'premium' | 'luxury';
  floorPrice?: number;
  secretCode?: string;
  stock?: number;
  frameCode?: string;
  isArchived?: boolean;
  archivedAt?: Date;
  web?: IWebFields;
}

const FrameSchema = new Schema<IFrame>(
  {
    companyName: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    houseName: { type: String, trim: true },
    type: { type: String, trim: true },
    costPrice: { type: Number, min: 0 },
    sellPrice: { type: Number, min: 0 },
    mrp: { type: Number, min: 0 },
    tier: { type: String, enum: ['essential', 'trendy', 'premium', 'luxury'] },
    floorPrice: { type: Number, min: 0 },
    secretCode: { type: String, trim: true },
    stock: { type: Number, min: 0, default: 0 },
    frameCode: { type: String, trim: true },
    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date },
    web: { type: WebFieldsSchema, default: () => ({ isPublished: false, images: [], tags: [], seo: {} }) },
  },
  { timestamps: true }
);

FrameSchema.index({ name: 'text', companyName: 'text', houseName: 'text' });
FrameSchema.index({ frameCode: 1 }, { sparse: true });
FrameSchema.index({ 'web.slug': 1 }, { unique: true, sparse: true });
FrameSchema.index({ 'web.isPublished': 1, 'web.publishedAt': -1 });

export const Frame = (mongoose.models['Frame'] as mongoose.Model<IFrame>) || mongoose.model<IFrame>('Frame', FrameSchema);
