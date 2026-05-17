import mongoose, { Schema, Document } from 'mongoose';

export interface IOpticalLens extends Document {
    brand: string;
    name: string;
    category: "Single Vision" | "Bifocal" | "Progressive";
    index?: string;
    coating?: string;
    spherical?: number;
    cylinder?: number;
    addition?: number;
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
            enum: ["Single Vision", "Bifocal", "Progressive"]
        },
        index: {
            type: String,
            required: false,
            enum: ["1.50", "1.56", "1.59", "1.60", "1.67", "1.74"]
        },
        coating: {
            type: String,
            required: true,
            enum: ["Hard Coat", "Anti-Reflective", "Blue Cut", "Blue Cut Blue", "Photochromic Hard Coat", "Photochromic Blue Cut", "Polycarbonate Blue Cut", "Polycarbonate Blue Cut Blue", "Polycarbonate Photochromic Blue Cut", "Tinted", "Other"]
        },
        spherical: { type: Number },
        cylinder: { type: Number },
        addition: { type: Number },
        costPrice: { type: Number, min: 0 },
        sellPrice: { type: Number, min: 0 },
    },
    { timestamps: true }
);

OpticalLensSchema.index(
    { brand: 1, name: 1, category: 1, index: 1, coating: 1, spherical: 1, cylinder: 1, addition: 1 },
    { unique: true }
);

OpticalLensSchema.index({ name: 'text', brand: 'text', category: 'text' });

export const OpticalLens = mongoose.model<IOpticalLens>('OpticalLens', OpticalLensSchema);
