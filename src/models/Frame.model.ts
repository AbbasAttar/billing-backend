import mongoose, { Schema, Document } from 'mongoose';
import { IWebFields, WebFieldsSchema } from './webFields.schema';

export interface IFrame extends Document {
  companyName: string;
  name: string;
  type?: string;
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  frameCode?: string;
  web?: IWebFields;
}

const FrameSchema = new Schema<IFrame>(
  {
    companyName: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, trim: true },
    costPrice: { type: Number, min: 0 },
    sellPrice: { type: Number, min: 0 },
    stock: { type: Number, min: 0, default: 0 },
    frameCode: { type: String, trim: true },
    web: { type: WebFieldsSchema, default: () => ({ isPublished: false, images: [], tags: [], seo: {} }) },
  },
  { timestamps: true }
);

FrameSchema.index({ name: 'text', companyName: 'text' });
FrameSchema.index({ frameCode: 1 }, { sparse: true });
FrameSchema.index({ 'web.slug': 1 }, { unique: true, sparse: true });
FrameSchema.index({ 'web.isPublished': 1, 'web.publishedAt': -1 });

export const Frame = (mongoose.models['Frame'] as mongoose.Model<IFrame>) || mongoose.model<IFrame>('Frame', FrameSchema);
