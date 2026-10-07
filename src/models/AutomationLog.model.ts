import { createFirestoreModel, BaseDoc, expireAfterDays } from '../lib/firestoreModel';

export interface IAutomationLog extends BaseDoc {
  ruleId: string | any;
  ruleName: string;
  triggeredAt: Date;
  segmentSize: number;
  eligible: number;
  sent: number;
  skipped: number;
  campaignId?: string | any;
  errorMessages: string[];
  /** TTL: Firestore deletes the doc after this time. */
  expireAt?: Date;
}

/** Firestore TTL deletes run logs after this long (see firestore.indexes.json). */
export const AUTOMATION_LOG_TTL_DAYS = 180;

export const AutomationLog = createFirestoreModel<IAutomationLog>('automationlogs', {
  beforeWrite: (payload, ctx) => {
    if (ctx.full && !payload.expireAt) {
      payload.expireAt = expireAfterDays(payload.triggeredAt ?? payload.createdAt, AUTOMATION_LOG_TTL_DAYS);
    }
  },
});
