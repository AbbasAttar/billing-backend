import mongoose, { Schema, Document } from 'mongoose';
import { LENS_TYPES, LENS_MATERIALS, LENS_COLORS } from './LensPricing.model';

export type PurchaseStatus = 'pending' | 'received';

export interface IPurchaseEntry extends Document {
  status:        PurchaseStatus;
  lensType:      typeof LENS_TYPES[number] | null;
  material:      typeof LENS_MATERIALS[number] | null;
  coating:       string | null;
  color:         typeof LENS_COLORS[number] | null;
  eye:           'right' | 'left' | 'both';
  sph:           number | null;
  cyl:           number;
  add:           number | null;
  qty:           number;
  costPerPair:   number | null;
  supplier?:     string | null;
  notes?:        string | null;
  purchaseDate:         Date;
  wholesalerOrderDate?: Date | null;
  importedFrom?:        string | null;
}

const PurchaseEntrySchema = new Schema<IPurchaseEntry>(
  {
    status:        { type: String, enum: ['pending', 'received'], required: true, default: 'received' },
    lensType:      { type: String, enum: LENS_TYPES, default: null },
    material:      { type: String, enum: LENS_MATERIALS, default: null },
    coating:       { type: String, trim: true, default: null },
    color:         { type: String, enum: LENS_COLORS, default: null },
    eye:           { type: String, enum: ['right', 'left', 'both'], default: 'both' },
    sph:           { type: Number, default: null },
    cyl:           { type: Number, default: 0 },
    add:           { type: Number, default: null },
    qty:           { type: Number, required: true, min: 0.0001 },
    costPerPair:   { type: Number, min: 0, default: null },
    supplier:      { type: String, default: null, trim: true },
    notes:         { type: String, default: null, trim: true },
    purchaseDate:         { type: Date, default: () => new Date() },
    wholesalerOrderDate:  { type: Date, default: null },
    importedFrom:         { type: String, default: null },
  },
  { timestamps: true },
);

PurchaseEntrySchema.index({ lensType: 1, material: 1, coating: 1, color: 1, sph: 1, cyl: 1, add: 1 });
PurchaseEntrySchema.index({ purchaseDate: -1 });
PurchaseEntrySchema.index({ status: 1 });

export const PurchaseEntry = mongoose.model<IPurchaseEntry>('PurchaseEntry', PurchaseEntrySchema);
