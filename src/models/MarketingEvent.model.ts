import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

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

export interface IMarketingEvent extends BaseDoc {
  eventType: MarketingEventType;
  campaignId?: string | any;
  customerId?: string | any;
  payload?: Record<string, unknown>;
  createdAt?: Date;
  updatedAt?: Date;
}

export const MarketingEvent = createFirestoreModel<IMarketingEvent>('marketingevents');
