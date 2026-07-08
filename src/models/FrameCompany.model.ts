import mongoose, { Schema, Document } from 'mongoose';

export interface IFrameCompany extends Document {
  code:        string;  // e.g. "01"
  name:        string;  // e.g. "Tulsi"
}

const FrameCompanySchema = new Schema<IFrameCompany>(
  {
    code: { type: String, required: true, unique: true, trim: true, maxlength: 2 },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

export const FrameCompany = mongoose.model<IFrameCompany>('FrameCompany', FrameCompanySchema);
