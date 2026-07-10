import mongoose, { Document, Schema, Types } from 'mongoose';

export const MARKETING_EVENT_TYPES = [
  'campaign_created',
  'campaign_sent',
  'campaign_cancelled',
  'message_sent',
  'message_delivered',
  'message_replied',
  'conversion_logged',
  'cache_invalidated',
] as const;
export type MarketingEventType = typeof MARKETING_EVENT_TYPES[number];

export interface IMarketingEvent extends Document {
  eventType: MarketingEventType;
  campaignId?: Types.ObjectId;
  customerId?: Types.ObjectId;
  payload?: Record<string, unknown>;
  createdAt: Date;
}

const MarketingEventSchema = new Schema<IMarketingEvent>(
  {
    eventType: { type: String, required: true, enum: MARKETING_EVENT_TYPES },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    payload: { type: Schema.Types.Mixed },
  },
  { timestamps: true, versionKey: false }
);

MarketingEventSchema.index({ campaignId: 1, createdAt: -1 });
MarketingEventSchema.index({ customerId: 1, eventType: 1 });
MarketingEventSchema.index({ createdAt: -1 });

export const MarketingEvent = mongoose.model<IMarketingEvent>('MarketingEvent', MarketingEventSchema);
