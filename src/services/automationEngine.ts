import { AutomationRule, IAutomationRule } from '../models/AutomationRule.model';
import { AutomationLog } from '../models/AutomationLog.model';
import { Campaign } from '../models/Campaign.model';
import { MarketingEvent } from '../models/MarketingEvent.model';
import { Customer } from '../models/Customer.model';
import { buildMarketingIntelligence } from './marketingIntelligence';
import { sendFreeFormMessage, buildWaLink } from './whatsapp';
import type { Types } from 'mongoose';

const MS_PER_DAY = 86_400_000;

// Returns the set of customer IDs messaged by this rule within the cooldown window
async function getRecentlySentIds(ruleId: Types.ObjectId, cooldownDays: number): Promise<Set<string>> {
  const since = new Date(Date.now() - cooldownDays * MS_PER_DAY);

  // Find campaigns created by this rule (tagged via payload) after the cooldown window
  const recentLogs = await AutomationLog.find({ ruleId, triggeredAt: { $gte: since } }).lean();
  if (!recentLogs.length) return new Set();

  const campaignIds = recentLogs.map((l) => l.campaignId).filter((id): id is Types.ObjectId => id != null);
  if (!campaignIds.length) return new Set();

  // Get the customer IDs that were targeted in those campaigns
  const events = await MarketingEvent.find({
    campaignId: { $in: campaignIds },
    eventType: 'message_sent',
  })
    .select('customerId')
    .lean();

  return new Set(events.map((e) => String(e.customerId)));
}

export interface RuleRunResult {
  ruleId: string;
  ruleName: string;
  segmentSize: number;
  eligible: number;
  sent: number;
  skipped: number;
  campaignId?: string;
  errors: string[];
}

export async function runAutomationRule(rule: IAutomationRule): Promise<RuleRunResult> {
  const errors: string[] = [];
  const result: RuleRunResult = {
    ruleId: String(rule._id),
    ruleName: rule.name,
    segmentSize: 0,
    eligible: 0,
    sent: 0,
    skipped: 0,
    errors,
  };

  try {
    // 1. Get current segment
    const intel = await buildMarketingIntelligence();
    const segCustomers = intel.segments[rule.triggerSegment];
    result.segmentSize = segCustomers.length;

    if (!segCustomers.length) {
      await recordLog(rule, result, undefined);
      return result;
    }

    // 2. Filter out recently contacted customers
    const recentIds = await getRecentlySentIds(rule._id as Types.ObjectId, rule.cooldownDays);
    let eligible = segCustomers.filter((c) => !recentIds.has(c.customerId));

    // 3. Apply batch limit
    if (rule.batchLimit > 0) {
      eligible = eligible.slice(0, rule.batchLimit);
    }
    result.eligible = eligible.length;

    if (!eligible.length) {
      await recordLog(rule, result, undefined);
      return result;
    }

    // 4. Fetch full customer docs for phone numbers
    const customerIds = eligible.map((c) => c.customerId);
    const customers = await Customer.find({ _id: { $in: customerIds } })
      .select('name mobileNumber')
      .lean();

    const phoneMap = new Map(customers.map((c) => [String(c._id), c]));

    // 5. Create a campaign record for traceability
    const campaign = await Campaign.create({
      name: `[Auto] ${rule.name} — ${new Date().toLocaleDateString('en-IN')}`,
      type: 'custom',
      channel: rule.action === 'send_whatsapp' ? 'whatsapp' : 'manual',
      audience: {
        segmentKey: rule.triggerSegment,
        customerIds: customerIds.map((id) => id as unknown as import('mongoose').Types.ObjectId),
      },
      message: { body: rule.messageTemplate },
      stats: { targeted: eligible.length, sent: 0, delivered: 0, replied: 0, converted: 0 },
      status: 'running',
      sentAt: new Date(),
    });

    result.campaignId = String(campaign._id);

    // 6. Send messages
    await Promise.all(
      eligible.map(async (c) => {
        const doc = phoneMap.get(c.customerId);
        if (!doc?.mobileNumber) {
          result.skipped += 1;
          return;
        }

        const body = rule.messageTemplate.replace(/\{name\}/g, doc.name);

        if (rule.action === 'send_whatsapp') {
          const sendResult = await sendFreeFormMessage({ phone: doc.mobileNumber, name: doc.name }, body);
          if (sendResult.status === 'sent') {
            result.sent += 1;
            campaign.stats.sent += 1;
          } else {
            result.skipped += 1;
            if (sendResult.error) errors.push(`${doc.name}: ${sendResult.error}`);
          }
        } else {
          // manual — just count it as sent (wa.me links are generated on the frontend)
          result.sent += 1;
          campaign.stats.sent += 1;
        }

        await MarketingEvent.create({
          eventType: 'message_sent',
          campaignId: campaign._id,
          customerId: c.customerId,
          payload: { auto: true, ruleId: rule._id },
        });
      })
    );

    campaign.status = 'completed';
    await campaign.save();

    // 7. Update rule metadata
    rule.lastRunAt = new Date();
    rule.lastRunStats = {
      targeted: result.eligible,
      sent: result.sent,
      skipped: result.skipped,
    };
    await (rule as any).save();

    await recordLog(rule, result, String(campaign._id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    console.error(`[AutomationEngine] Rule "${rule.name}" failed:`, msg);
  }

  return result;
}

async function recordLog(rule: IAutomationRule, result: RuleRunResult, campaignId: string | undefined) {
  await AutomationLog.create({
    ruleId: rule._id,
    ruleName: rule.name,
    triggeredAt: new Date(),
    segmentSize: result.segmentSize,
    eligible: result.eligible,
    sent: result.sent,
    skipped: result.skipped,
    campaignId: campaignId ?? undefined,
    errorMessages: result.errors,
  });
}

export async function runAllActiveRules(): Promise<RuleRunResult[]> {
  const rules = await AutomationRule.find({ isActive: true }).lean();
  console.log(`[AutomationEngine] Running ${rules.length} active rule(s)`);

  const results: RuleRunResult[] = [];
  for (const rule of rules) {
    // Run sequentially to avoid hammering the DB / external APIs
    const result = await runAutomationRule(rule as IAutomationRule);
    results.push(result);
  }
  return results;
}
