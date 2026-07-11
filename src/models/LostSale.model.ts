import mongoose, { Schema, Document } from 'mongoose';

export interface ILostSale extends Document {
  date: Date;
  productDescription: string;
  category: 'frame' | 'opticalLens' | 'fragrance' | 'other';
  qty: number;
  estimatedPrice: number;
  customer?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LostSaleSchema = new Schema<ILostSale>(
  {
    date: { type: Date, required: true, default: Date.now },
    productDescription: { type: String, required: true, trim: true },
    category: { type: String, enum: ['frame', 'opticalLens', 'fragrance', 'other'], required: true },
    qty: { type: Number, required: true, default: 1, min: 1 },
    estimatedPrice: { type: Number, required: true, min: 0 },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export const LostSale = mongoose.model<ILostSale>('LostSale', LostSaleSchema);
