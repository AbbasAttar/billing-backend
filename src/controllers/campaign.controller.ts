import { Request, Response, NextFunction } from 'express';
import { Campaign, CAMPAIGN_TYPES, CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, SEGMENT_KEYS } from '../models/Campaign.model';
import { MarketingEvent } from '../models/MarketingEvent.model';
import { Customer } from '../models/Customer.model';
import { buildMarketingIntelligence } from '../services/marketingIntelligence';
import { sendFreeFormMessage, buildWaLink } from '../services/whatsapp';

// ── GET /api/campaigns ────────────────────────────────────────────────────────
export const listCampaigns = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 }).lean();
    res.json(campaigns);
  } catch (err) {
    next(err);
  }
};

// ── POST /api/campaigns ───────────────────────────────────────────────────────
export const createCampaign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, type, channel, audience, message, scheduledAt } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ message: 'name is required' });
      return;
    }
    if (!CAMPAIGN_TYPES.includes(type)) {
      res.status(400).json({ message: `type must be one of: ${CAMPAIGN_TYPES.join(', ')}` });
      return;
    }
    if (!CAMPAIGN_CHANNELS.includes(channel)) {
      res.status(400).json({ message: `channel must be one of: ${CAMPAIGN_CHANNELS.join(', ')}` });
      return;
    }
    if (!audience || (!audience.segmentKey && !Array.isArray(audience.customerIds))) {
      res.status(400).json({ message: 'audience.segmentKey or audience.customerIds is required' });
      return;
    }
    if (audience.segmentKey && !SEGMENT_KEYS.includes(audience.segmentKey)) {
      res.status(400).json({ message: `audience.segmentKey must be one of: ${SEGMENT_KEYS.join(', ')}` });
      return;
    }
    if (!message?.body?.trim()) {
      res.status(400).json({ message: 'message.body is required' });
      return;
    }

    const campaign = await Campaign.create({
      name: name.trim(),
      type,
      channel,
      audience,
      message,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    });

    await MarketingEvent.create({ eventType: 'campaign_created', campaignId: campaign._id });

    res.status(201).json(campaign);
  } catch (err) {
    next(err);
  }
};

// ── GET /api/campaigns/:id ────────────────────────────────────────────────────
export const getCampaign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) {
      res.status(404).json({ message: 'Campaign not found' });
      return;
    }
    res.json(campaign);
  } catch (err) {
    next(err);
  }
};

// ── PATCH /api/campaigns/:id ──────────────────────────────────────────────────
export const updateCampaign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      res.status(404).json({ message: 'Campaign not found' });
      return;
    }
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      res.status(409).json({ message: 'Only draft or scheduled campaigns can be edited' });
      return;
    }

    const allowed = ['name', 'type', 'channel', 'audience', 'message', 'scheduledAt', 'status'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        (campaign as any)[key] = req.body[key];
      }
    }

    await campaign.save();
    res.json(campaign);
  } catch (err) {
    next(err);
  }
};

// ── DELETE /api/campaigns/:id ─────────────────────────────────────────────────
export const deleteCampaign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      res.status(404).json({ message: 'Campaign not found' });
      return;
    }
    if (campaign.status === 'running') {
      res.status(409).json({ message: 'Cannot delete a running campaign' });
      return;
    }
    await campaign.deleteOne();
    res.json({ message: 'Campaign deleted' });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/campaigns/:id/send ──────────────────────────────────────────────
export const sendCampaign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      res.status(404).json({ message: 'Campaign not found' });
      return;
    }
    if (!['draft', 'scheduled'].includes(campaign.status)) {
      res.status(409).json({ message: 'Campaign has already been sent or cancelled' });
      return;
    }

    // Resolve audience → customer list
    let customerIds: string[] = [];
    if (campaign.audience.segmentKey) {
      const intel = await buildMarketingIntelligence();
      const segCustomers = intel.segments[campaign.audience.segmentKey];
      customerIds = segCustomers.map((c) => c.customerId);
    } else if (campaign.audience.customerIds?.length) {
      customerIds = campaign.audience.customerIds.map(String);
    }

    if (!customerIds.length) {
      res.status(400).json({ message: 'No customers in audience' });
      return;
    }

    const customers = await Customer.find({ _id: { $in: customerIds } })
      .select('name mobileNumber')
      .lean();

    campaign.status = 'running';
    campaign.sentAt = new Date();
    campaign.stats.targeted = customers.length;
    await campaign.save();

    await MarketingEvent.create({ eventType: 'campaign_sent', campaignId: campaign._id, payload: { targeted: customers.length } });

    // Send messages (WhatsApp channel) — others return wa.me links
    const results = await Promise.all(
      customers.map(async (c) => {
        if (!c.mobileNumber) return { customerId: c._id, status: 'skipped', reason: 'no phone' };

        if (campaign.channel === 'whatsapp') {
          const result = await sendFreeFormMessage(
            { phone: c.mobileNumber, name: c.name },
            campaign.message.body.replace(/\{name\}/g, c.name)
          );
          if (result.status === 'sent') campaign.stats.sent += 1;
          await MarketingEvent.create({
            eventType: 'message_sent',
            campaignId: campaign._id,
            customerId: c._id,
            payload: { status: result.status, messageId: result.messageId },
          });
          return { customerId: c._id, ...result };
        }

        // manual / sms / email — return wa.me link as fallback
        const waLink = buildWaLink(c.mobileNumber, campaign.message.body.replace(/\{name\}/g, c.name));
        return { customerId: c._id, status: 'manual', waLink };
      })
    );

    campaign.status = 'completed';
    await campaign.save();

    res.json({ campaign, results });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/campaigns/:id/convert ──────────────────────────────────────────
export const logConversion = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerId, revenue = 0 } = req.body;
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      res.status(404).json({ message: 'Campaign not found' });
      return;
    }

    campaign.stats.converted += 1;
    campaign.revenueGenerated += Number(revenue);
    await campaign.save();

    await MarketingEvent.create({
      eventType: 'conversion_logged',
      campaignId: campaign._id,
      customerId: customerId ?? undefined,
      payload: { revenue },
    });

    res.json({ message: 'Conversion logged', stats: campaign.stats, revenueGenerated: campaign.revenueGenerated });
  } catch (err) {
    next(err);
  }
};
