import mongoose, { Schema, Document } from 'mongoose';

export const LENS_TYPES     = ['Single Vision', 'Bifocal', 'Progressive'] as const;
export const LENS_MATERIALS = ['Polycarbonate', 'Fiber', 'Glass'] as const;
export const LENS_COLORS    = ['White', 'Photo Chromatic', 'Polarized', 'Tinted'] as const;
export const AXIS_TYPES     = ['any', 'ready', 'cross'] as const;

export type LensType     = typeof LENS_TYPES[number];
export type LensMaterial = typeof LENS_MATERIALS[number];
export type LensColor    = typeof LENS_COLORS[number];
export type AxisType     = typeof AXIS_TYPES[number];

export interface ILensPricing extends Document {
  lensType:  LensType;
  material:  LensMaterial;
  coating:   string;
  color:     LensColor;
  axisType:  AxisType;   // 'ready' | 'cross' | 'any'
  // Absolute value ranges — lookup uses max(|RE|, |LE|) for each field
  minSph:    number;           // e.g. 0.00
  maxSph:    number;           // e.g. 6.00
  minCyl:    number;           // e.g. 0.00
  maxCyl:    number;           // e.g. 2.00
  minAdd:    number | null;    // null = not required (Single Vision)
  maxAdd:    number | null;    // null = no upper limit on ADD
  price:     number;
  costPrice: number;
}

const LensPricingSchema = new Schema<ILensPricing>(
  {
    lensType:  { type: String, required: true, enum: LENS_TYPES },
    material:  { type: String, required: true, enum: LENS_MATERIALS },
    coating:   { type: String, required: true, trim: true },
    color:     { type: String, required: true, enum: LENS_COLORS },
    axisType:  { type: String, required: true, enum: AXIS_TYPES, default: 'any' },
    minSph:    { type: Number, required: true },
    maxSph:    { type: Number, required: true },
    minCyl:    { type: Number, required: true },
    maxCyl:    { type: Number, required: true },
    minAdd:    { type: Number, default: null },
    maxAdd:    { type: Number, default: null },
    price:     { type: Number, required: true, min: 0 },
    costPrice: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true }
);

export const LensPricing = mongoose.model<ILensPricing>('LensPricing', LensPricingSchema);
