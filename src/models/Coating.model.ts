import mongoose, { Schema, Document } from 'mongoose';

export interface ICoating extends Document {
  name: string;
}

const CoatingSchema = new Schema<ICoating>(
  { name: { type: String, required: true, trim: true, unique: true } },
  { timestamps: true }
);

export const Coating = mongoose.model<ICoating>('Coating', CoatingSchema);
