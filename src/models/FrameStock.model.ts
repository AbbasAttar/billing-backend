import mongoose, { Schema, Document } from 'mongoose';

export interface IFrameStock extends Document {
  frameCode:     string;   // full 10-digit code, unique
  companyCode:   string;   // CC  e.g. "01"
  companyName:   string;   // resolved at write-time e.g. "Tulsi"
  costPrice:     number;   // from PPPP
  sellPrice:     number;   // user-set selling price
  purchaseMonth: number;   // 1–12
  purchaseYear:  number;   // e.g. 2026
  quantity:      number;
  reorderLevel:  number;
}

const FrameStockSchema = new Schema<IFrameStock>(
  {
    frameCode:     { type: String, required: true, unique: true, trim: true },
    companyCode:   { type: String, required: true, trim: true },
    companyName:   { type: String, required: true, trim: true },
    costPrice:     { type: Number, required: true, min: 0 },
    sellPrice:     { type: Number, required: true, min: 0 },
    purchaseMonth: { type: Number, required: true, min: 1, max: 12 },
    purchaseYear:  { type: Number, required: true },
    quantity:      { type: Number, required: true, min: 0, default: 0 },
    reorderLevel:  { type: Number, required: true, min: 0, default: 2 },
  },
  { timestamps: true }
);

FrameStockSchema.index({ companyCode: 1, purchaseYear: 1, purchaseMonth: 1 });

export const FrameStock = mongoose.model<IFrameStock>('FrameStock', FrameStockSchema);
