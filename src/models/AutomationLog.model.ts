import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAutomationLog extends Document {
  ruleId: Types.ObjectId;
  ruleName: string;
  triggeredAt: Date;
  segmentSize: number;
  eligible: number;
  sent: number;
  skipped: number;
  campaignId?: Types.ObjectId;
  errorMessages: string[];
}

const AutomationLogSchema = new Schema<IAutomationLog>(
  {
    ruleId: { type: Schema.Types.ObjectId, ref: 'AutomationRule', required: true },
    ruleName: { type: String, required: true },
    triggeredAt: { type: Date, default: Date.now },
    segmentSize: { type: Number, default: 0 },
    eligible: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign' },
    errorMessages: [String],
  },
  { timestamps: false, versionKey: false }
);

AutomationLogSchema.index({ ruleId: 1, triggeredAt: -1 });
AutomationLogSchema.index({ triggeredAt: -1 });

export const AutomationLog = mongoose.model<IAutomationLog>('AutomationLog', AutomationLogSchema);
