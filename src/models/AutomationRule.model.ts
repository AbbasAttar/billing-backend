import mongoose, { Document, Schema } from 'mongoose';
import { SEGMENT_KEYS, type SegmentKey } from './Campaign.model';

export const AUTOMATION_ACTIONS = ['send_whatsapp', 'send_manual_links'] as const;
export type AutomationAction = typeof AUTOMATION_ACTIONS[number];

export interface IAutomationRule extends Document {
  name: string;
  isActive: boolean;
  triggerSegment: SegmentKey;
  action: AutomationAction;
  messageTemplate: string;
  // Cooldown: minimum days between messages to the same customer from this rule
  cooldownDays: number;
  // How many customers to contact per run (0 = unlimited)
  batchLimit: number;
  lastRunAt?: Date;
  lastRunStats?: {
    targeted: number;
    sent: number;
    skipped: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AutomationRuleSchema = new Schema<IAutomationRule>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    isActive: { type: Boolean, default: false },
    triggerSegment: { type: String, required: true, enum: SEGMENT_KEYS },
    action: { type: String, required: true, enum: AUTOMATION_ACTIONS, default: 'send_manual_links' },
    messageTemplate: { type: String, required: true, maxlength: 1000 },
    cooldownDays: { type: Number, default: 30, min: 1, max: 365 },
    batchLimit: { type: Number, default: 0, min: 0 },
    lastRunAt: { type: Date },
    lastRunStats: {
      targeted: { type: Number },
      sent: { type: Number },
      skipped: { type: Number },
    },
  },
  { timestamps: true }
);

AutomationRuleSchema.index({ isActive: 1 });
AutomationRuleSchema.index({ triggerSegment: 1 });

export const AutomationRule = mongoose.model<IAutomationRule>('AutomationRule', AutomationRuleSchema);
