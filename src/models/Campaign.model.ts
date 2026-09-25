import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

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
  customerIds?: string[] | any[];
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

export interface ICampaign extends BaseDoc {
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
  createdAt?: Date;
  updatedAt?: Date;
}

export const Campaign = createFirestoreModel<ICampaign>('campaigns');
