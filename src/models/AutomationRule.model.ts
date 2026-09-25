import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';
import { type SegmentKey } from './Campaign.model';

export const AUTOMATION_ACTIONS = ['send_whatsapp', 'send_manual_links'] as const;
export type AutomationAction = typeof AUTOMATION_ACTIONS[number];

export interface IAutomationRule extends BaseDoc {
  name: string;
  isActive: boolean;
  triggerSegment: SegmentKey;
  action: AutomationAction;
  messageTemplate: string;
  cooldownDays: number;
  batchLimit: number;
  lastRunAt?: Date;
  lastRunStats?: {
    targeted: number;
    sent: number;
    skipped: number;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export const AutomationRule = createFirestoreModel<IAutomationRule>('automationrules');
