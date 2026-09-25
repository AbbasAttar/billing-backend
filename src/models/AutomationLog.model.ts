import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

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
}

export const AutomationLog = createFirestoreModel<IAutomationLog>('automationlogs');
