import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomer extends Document {
  name: string;
  address?: string;
  mobileNumber: string;
  email?: string;
  dateOfBirth?: Date;
  tags: string[];
  notes?: string;
  preferredChannel?: 'whatsapp' | 'sms' | 'email';
  lastContactedAt?: Date;
  lastContactType?: string;
  snoozedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    mobileNumber: { type: String, required: false, trim: true },
    email: { type: String, trim: true, lowercase: true },
    dateOfBirth: { type: Date },
    tags: { type: [String], default: [] },
    notes: { type: String, trim: true },
    preferredChannel: { type: String, enum: ['whatsapp', 'sms', 'email'] },
    lastContactedAt: { type: Date },
    lastContactType: { type: String, trim: true },
    snoozedUntil: { type: Date },
  },
  { timestamps: true }
);

CustomerSchema.index({ name: 'text' });
CustomerSchema.index({ mobileNumber: 1 });
CustomerSchema.index({ tags: 1 });

export const Customer = mongoose.model<ICustomer>('Customer', CustomerSchema);
