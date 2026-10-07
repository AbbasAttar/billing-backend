import { createFirestoreModel, BaseDoc, expireAfterDays } from '../lib/firestoreModel';

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
  /** TTL: Firestore deletes the doc after this time. */
  expireAt?: Date;
}

/** Firestore TTL deletes events after this long (see firestore.indexes.json); longer than any automation cooldown. */
export const MARKETING_EVENT_TTL_DAYS = 365;

export const MarketingEvent = createFirestoreModel<IMarketingEvent>('marketingevents', {
  beforeWrite: (payload, ctx) => {
    if (ctx.full && !payload.expireAt) payload.expireAt = expireAfterDays(payload.createdAt, MARKETING_EVENT_TTL_DAYS);
  },
});
