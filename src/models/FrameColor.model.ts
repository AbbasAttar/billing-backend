import mongoose, { Schema, Document } from 'mongoose';

export interface IFrameColor extends Document {
  name: string;
  hex: string;
}

const FrameColorSchema = new Schema<IFrameColor>(
  {
    name: { type: String, required: true, trim: true },
    hex:  { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

FrameColorSchema.index({ name: 1 }, { unique: true });

export const FrameColor = mongoose.model<IFrameColor>('FrameColor', FrameColorSchema);
