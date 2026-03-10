import mongoose, { Schema, Document } from 'mongoose';

export interface IFragrance extends Document {
  type: 'perfume' | 'attar' | 'bakhoor';
  companyName: string;
  name: string;
}

const FragranceSchema = new Schema<IFragrance>(
  {
    type: {
      type: String,
      enum: ['perfume', 'attar', 'bakhoor'],
      required: true,
    },
    companyName: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

FragranceSchema.index({ name: 'text', companyName: 'text' });

export const Fragrance = mongoose.model<IFragrance>('Fragrance', FragranceSchema);
