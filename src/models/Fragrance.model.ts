import mongoose, { Schema, Document } from 'mongoose';
import { IWebFields, WebFieldsSchema } from './webFields.schema';

export interface IFragranceVariant {
  label: string;
  costPrice?: number;
  sellPrice: number;
  stock: number;
}

export interface IFragrance extends Document {
  type: 'perfume' | 'attar' | 'bakhoor';
  companyName: string;
  name: string;
  authenticity?: 'original' | 'dupe';
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  variants: IFragranceVariant[];
  web?: IWebFields;
}

const FragranceVariantSchema = new Schema<IFragranceVariant>(
  {
    label: { type: String, required: true, trim: true },
    costPrice: { type: Number, min: 0 },
    sellPrice: { type: Number, required: true, min: 0 },
    stock: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const FragranceSchema = new Schema<IFragrance>(
  {
    type: {
      type: String,
      enum: ['perfume', 'attar', 'bakhoor'],
      required: true,
    },
    companyName: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    authenticity: { type: String, enum: ['original', 'dupe'] },
    costPrice: { type: Number, min: 0 },
    sellPrice: { type: Number, min: 0 },
    stock: { type: Number, min: 0, default: 0 },
    variants: { type: [FragranceVariantSchema], default: [] },
    web: { type: WebFieldsSchema, default: () => ({ isPublished: false, images: [], tags: [], seo: {} }) },
  },
  { timestamps: true }
);

FragranceSchema.index({ name: 'text', companyName: 'text' });
FragranceSchema.index({ 'web.slug': 1 }, { unique: true, sparse: true });
FragranceSchema.index({ 'web.isPublished': 1, 'web.publishedAt': -1 });

export const Fragrance = mongoose.model<IFragrance>('Fragrance', FragranceSchema);
