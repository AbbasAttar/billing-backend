import mongoose, { Schema, Document } from 'mongoose';

export interface ICoating extends Document {
  name: string;
  shortName?: string;
}

const CoatingSchema = new Schema<ICoating>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    shortName: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

export const Coating = mongoose.model<ICoating>('Coating', CoatingSchema);
