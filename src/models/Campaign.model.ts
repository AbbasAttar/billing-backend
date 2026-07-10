import mongoose, { Document, Schema, Types } from 'mongoose';

export const CAMPAIGN_TYPES = ['recovery', 'upgrade', 'launch', 'festival', 'birthday', 'custom'] as const;
export type CampaignType = typeof CAMPAIGN_TYPES[number];

export const CAMPAIGN_CHANNELS = ['whatsapp', 'sms', 'email', 'manual'] as const;
export type CampaignChannel = typeof CAMPAIGN_CHANNELS[number];

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'completed', 'cancelled'] as const;
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number];

export const SEGMENT_KEYS = ['new', 'vip', 'lost', 'atRisk', 'highDiscount', 'crossSell'] as const;
export type SegmentKey = typeof SEGMENT_KEYS[number];

export interface ICampaignAudience {
  segmentKey?: SegmentKey;
  customerIds?: Types.ObjectId[];
  filters?: {
    tags?: string[];
    minLTV?: number;
    maxRecencyDays?: number;
    productCategory?: 'frame' | 'opticalLens' | 'fragrance';
  };
}

export interface ICampaignMessage {
  body: string;
  subject?: string;
  mediaUrl?: string;
}

export interface ICampaignStats {
  targeted: number;
  sent: number;
  delivered: number;
  replied: number;
  converted: number;
}

export interface ICampaign extends Document {
  name: string;
  type: CampaignType;
  channel: CampaignChannel;
  status: CampaignStatus;
  audience: ICampaignAudience;
  message: ICampaignMessage;
  scheduledAt?: Date;
  sentAt?: Date;
  stats: ICampaignStats;
  revenueGenerated: number;
  createdAt: Date;
  updatedAt: Date;
}

const AudienceSchema = new Schema<ICampaignAudience>(
  {
    segmentKey: { type: String, enum: SEGMENT_KEYS },
    customerIds: [{ type: Schema.Types.ObjectId, ref: 'Customer' }],
    filters: {
      tags: [String],
      minLTV: Number,
      maxRecencyDays: Number,
      productCategory: { type: String, enum: ['frame', 'opticalLens', 'fragrance'] },
    },
  },
  { _id: false }
);

const MessageSchema = new Schema<ICampaignMessage>(
  {
    body: { type: String, required: true, maxlength: 1000 },
    subject: { type: String, maxlength: 200 },
    mediaUrl: { type: String },
  },
  { _id: false }
);

const StatsSchema = new Schema<ICampaignStats>(
  {
    targeted: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    replied: { type: Number, default: 0 },
    converted: { type: Number, default: 0 },
  },
  { _id: false }
);

const CampaignSchema = new Schema<ICampaign>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    type: { type: String, required: true, enum: CAMPAIGN_TYPES },
    channel: { type: String, required: true, enum: CAMPAIGN_CHANNELS },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'draft' },
    audience: { type: AudienceSchema, required: true },
    message: { type: MessageSchema, required: true },
    scheduledAt: { type: Date },
    sentAt: { type: Date },
    stats: { type: StatsSchema, default: () => ({}) },
    revenueGenerated: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

CampaignSchema.index({ status: 1, createdAt: -1 });
CampaignSchema.index({ type: 1 });

export const Campaign = mongoose.model<ICampaign>('Campaign', CampaignSchema);
