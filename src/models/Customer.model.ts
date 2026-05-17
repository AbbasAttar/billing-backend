import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomer extends Document {
  name: string;
  address?: string;
  mobileNumber: string;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    mobileNumber: { type: String, required: false, trim: true },
  },
  { timestamps: true }
);

CustomerSchema.index({ name: 'text' });
CustomerSchema.index({ mobileNumber: 1 });

export const Customer = mongoose.model<ICustomer>('Customer', CustomerSchema);
