import mongoose, { Schema, Document } from 'mongoose';

export type AdSpendChannel =
  | 'whatsapp'
  | 'facebook'
  | 'instagram'
  | 'google'
  | 'sms'
  | 'newspaper'
  | 'flyers'
  | 'events'
  | 'other';

export interface IAdSpend extends Document {
  date: Date;
  channel: AdSpendChannel;
  campaignName?: string;
  amount: number;
  notes?: string;
}

const AdSpendSchema = new Schema<IAdSpend>(
  {
    date: { type: Date, required: true },
    channel: {
      type: String,
      required: true,
      enum: ['whatsapp', 'facebook', 'instagram', 'google', 'sms', 'newspaper', 'flyers', 'events', 'other'],
    },
    campaignName: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

AdSpendSchema.index({ date: -1 });
AdSpendSchema.index({ channel: 1, date: -1 });

export const AdSpend = mongoose.model<IAdSpend>('AdSpend', AdSpendSchema);
