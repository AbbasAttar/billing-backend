import mongoose, { Schema, Document } from 'mongoose';

export interface IFrame extends Document {
  companyName: string;
  name: string;
  type?: string;
  costPrice?: number;
  sellPrice?: number;
}

const FrameSchema = new Schema<IFrame>(
  {
    companyName: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, trim: true },
    costPrice: { type: Number, min: 0 },
    sellPrice: { type: Number, min: 0 },
  },
  { timestamps: true }
);

FrameSchema.index({ name: 'text', companyName: 'text' });

export const Frame = mongoose.model<IFrame>('Frame', FrameSchema);
