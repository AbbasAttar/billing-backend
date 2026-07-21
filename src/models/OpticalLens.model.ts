import mongoose, { Schema, Document } from 'mongoose';
import { IWebFields, WebFieldsSchema } from './webFields.schema';

export interface IOpticalLens extends Document {
    brand: string;
    name: string;
    category: 'Single Vision' | 'Bifocal' | 'Progressive';
    index?: string;
    coating?: string | null;
    spherical?: number;
    cylinder?: number;
    addition?: number;
    costPrice?: number;
    sellPrice?: number;
    web?: IWebFields;
}

const OpticalLensSchema = new Schema<IOpticalLens>(
    {
        brand: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        category: {
            type: String,
            required: true,
            enum: ["Single Vision", "Bifocal", "Progressive"]
        },
        index: {
            type: String,
            required: false,
            enum: ["1.50", "1.56", "1.59", "1.60", "1.67", "1.74"]
        },
        coating: { type: String, required: false, default: null },
        spherical: { type: Number },
        cylinder: { type: Number },
        addition: { type: Number },
        costPrice: { type: Number, min: 0 },
        sellPrice: { type: Number, min: 0 },
        web: { type: WebFieldsSchema, default: () => ({ isPublished: false, images: [], tags: [], seo: {} }) },
    },
    { timestamps: true }
);

OpticalLensSchema.index(
    { brand: 1, name: 1, category: 1, index: 1, coating: 1, spherical: 1, cylinder: 1, addition: 1 },
    { unique: true }
);

OpticalLensSchema.index({ name: 'text', brand: 'text', category: 'text' });
OpticalLensSchema.index({ 'web.slug': 1 }, { unique: true, sparse: true });
OpticalLensSchema.index({ 'web.isPublished': 1, 'web.publishedAt': -1 });

export const OpticalLens = (mongoose.models['OpticalLens'] as mongoose.Model<IOpticalLens>) || mongoose.model<IOpticalLens>('OpticalLens', OpticalLensSchema);
