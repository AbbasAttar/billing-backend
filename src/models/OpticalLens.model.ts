import mongoose, { Schema, Document } from 'mongoose';

export interface IOpticalLens extends Document {
    name: string;
    category: string;
    brand?: string;
    material?: string;
    coating?: string;
    costPrice?: number;
    sellPrice?: number;
}

const OpticalLensSchema = new Schema<IOpticalLens>(
    {
        name: { type: String, required: true, trim: true },
        category: { type: String, required: true, trim: true },
        brand: { type: String, trim: true },
        material: { type: String, trim: true },
        coating: { type: String, trim: true },
        costPrice: { type: Number, min: 0 },
        sellPrice: { type: Number, min: 0 },
    },
    { timestamps: true }
);

OpticalLensSchema.index({ name: 'text', brand: 'text', category: 'text' });

export const OpticalLens = mongoose.model<IOpticalLens>('OpticalLens', OpticalLensSchema);
