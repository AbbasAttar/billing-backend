import mongoose, { Schema, Document } from 'mongoose';
import { LENS_TYPES, LENS_MATERIALS, LENS_COLORS } from './LensPricing.model';

export interface ILensStock extends Document {
  lensType:    typeof LENS_TYPES[number];
  material:    typeof LENS_MATERIALS[number];
  coating:     string;
  color:       typeof LENS_COLORS[number];
  sph:         number;
  cyl:         number;
  add:         number | null;
  quantity:    number;
  reorderLevel: number;
  costPrice:   number;
}

const LensStockSchema = new Schema<ILensStock>(
  {
    lensType:     { type: String, required: true, enum: LENS_TYPES },
    material:     { type: String, required: true, enum: LENS_MATERIALS },
    coating:      { type: String, required: true, trim: true },
    color:        { type: String, required: true, enum: LENS_COLORS },
    sph:          { type: Number, required: true },
    cyl:          { type: Number, required: true, default: 0 },
    add:          { type: Number, default: null },
    quantity:     { type: Number, required: true, min: 0, default: 0 },
    reorderLevel: { type: Number, required: true, min: 0, default: 2 },
    costPrice:    { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true }
);

LensStockSchema.index(
  { lensType: 1, material: 1, coating: 1, color: 1, sph: 1, cyl: 1, add: 1 },
  { unique: true }
);

export const LensStock = mongoose.model<ILensStock>('LensStock', LensStockSchema);
