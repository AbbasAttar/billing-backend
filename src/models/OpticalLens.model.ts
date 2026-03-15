import mongoose, { Schema, Document } from 'mongoose';

export interface IOpticalLens extends Document {
    brand: string;
    name: string;
    category: "Single Vision" | "Bifocal" | "Progressive" | "Office" | "Other";
    index?: string;
    coating?: string;
    costPrice?: number;
    sellPrice?: number;
}

const OpticalLensSchema = new Schema<IOpticalLens>(
    {
        brand: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        category: {
            type: String,
            required: true,
            enum: ["Single Vision", "Bifocal", "Progressive", "Office", "Other"]
        },
        index: {
            type: String,
            required: false,
            enum: ["1.50", "1.56", "1.60", "1.67", "1.74", "Polycarbonate", "Trivex", "Other"]
        },
        coating: {
            type: String,
            required: false,
            enum: ["White", "Anti-Reflective", "Blue Cut", "Photochromic", "Tinted", "Other"]
        },
        costPrice: { type: Number, min: 0 },
        sellPrice: { type: Number, min: 0 },
    },
    { timestamps: true }
);

OpticalLensSchema.index(
    { brand: 1, name: 1, category: 1, index: 1, coating: 1 },
    { unique: true, sparse: true }
);

OpticalLensSchema.index({ name: 'text', brand: 'text', category: 'text' });

export const OpticalLens = mongoose.model<IOpticalLens>('OpticalLens', OpticalLensSchema);
