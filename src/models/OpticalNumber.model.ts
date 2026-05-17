import mongoose, { Schema, Document } from 'mongoose';

export interface IOpticalNumber extends Document {
  customer: mongoose.Types.ObjectId;
  name: string;
  leftSpherical?: number;
  leftCylinder?: number;
  leftAddition?: number;
  leftAxis?: number;
  rightSpherical?: number;
  rightCylinder?: number;
  rightAddition?: number;
  rightAxis?: number;
  lensType?: string;
}

const OpticalNumberSchema = new Schema<IOpticalNumber>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    name: { type: String, required: true, trim: true },
    leftSpherical: { type: Number },
    leftCylinder: { type: Number },
    leftAddition: { type: Number },
    leftAxis: { type: Number },
    rightSpherical: { type: Number },
    rightCylinder: { type: Number },
    rightAddition: { type: Number },
    rightAxis: { type: Number },
    lensType: { type: String, trim: true },
  },
  { timestamps: true }
);

OpticalNumberSchema.index({ customer: 1 });

export const OpticalNumber = mongoose.model<IOpticalNumber>('OpticalNumber', OpticalNumberSchema);
