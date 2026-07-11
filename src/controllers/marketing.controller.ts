import { Request, Response, NextFunction } from 'express';
import { buildMarketingIntelligence } from '../services/marketingIntelligence';
import { generateCampaignCopy } from '../services/aiCopy';

// ── In-memory cache (10 min TTL) ─────────────────────────────────────────────
const CACHE_TTL_MS = 10 * 60 * 1_000;

let cache: { data: Awaited<ReturnType<typeof buildMarketingIntelligence>>; expiresAt: number } | null = null;

async function getIntelligence() {
  if (cache && Date.now() < cache.expiresAt) return cache.data;
  const data = await buildMarketingIntelligence();
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

// ── GET /api/marketing/summary ────────────────────────────────────────────────
export const getMarketingSummary = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const intel = await getIntelligence();
    res.json({
      generatedAt: intel.generatedAt,
      summary: intel.summary,
      suggestions: intel.suggestions,
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/marketing/suggestions ───────────────────────────────────────────
export const getSuggestions = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const intel = await getIntelligence();
    res.json({ generatedAt: intel.generatedAt, suggestions: intel.suggestions });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/marketing/segments/:segment ─────────────────────────────────────
const VALID_SEGMENTS = [
  'new', 'vip', 'lost', 'atRisk', 'highDiscount', 'crossSell',
  'fragranceNeverOptical', 'eyeTestDue', 'cheapFrameUpgrade',
  'blueCutUpgrade', 'premiumPerfumeUpgrade', 'inactive120', 'birthdayThisMonth',
] as const;
type SegmentKey = (typeof VALID_SEGMENTS)[number];

export const getSegment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { segment } = req.params;
    if (!VALID_SEGMENTS.includes(segment as SegmentKey)) {
      res.status(400).json({
        message: `Invalid segment. Valid values: ${VALID_SEGMENTS.join(', ')}`,
      });
      return;
    }

    const intel = await getIntelligence();
    const customers = intel.segments[segment as SegmentKey];

    res.json({
      generatedAt: intel.generatedAt,
      segment,
      count: customers.length,
      customers,
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/marketing/recovery-center ───────────────────────────────────────
const RECOVERY_SEGMENT_META: Record<string, { label: string; description: string }> = {
  fragranceNeverOptical: { label: 'Fragrance → Spectacles', description: 'Fragrance buyers who have never bought optical products' },
  eyeTestDue: { label: 'Eye Test Due', description: 'Optical customers whose last visit was 18+ months ago' },
  cheapFrameUpgrade: { label: 'Frame Upgrade', description: 'Customers with budget frames who may want premium options' },
  blueCutUpgrade: { label: 'Add Blue Cut', description: 'Lens buyers without blue-cut coating' },
  premiumPerfumeUpgrade: { label: 'Premium Perfume', description: 'Fragrance buyers spending below ₹700 avg — introduce premium range' },
  inactive120: { label: 'Recover', description: 'Customers inactive 120–179 days — last chance before they go cold' },
  birthdayThisMonth: { label: 'Birthday This Month', description: 'Customers with a birthday this month — ideal for personalised outreach' },
};

export const getRecoveryCenter = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const intel = await getIntelligence();
    const cards = Object.entries(RECOVERY_SEGMENT_META).map(([key, meta]) => {
      const customers = intel.segments[key as SegmentKey] ?? [];
      const potentialRevenue = customers.reduce((sum: number, c: any) => sum + (c.averageOrderValue ?? 0), 0);
      return {
        key,
        label: meta.label,
        description: meta.description,
        count: customers.length,
        potentialRevenue: Math.round(potentialRevenue),
        sampleCustomers: customers.slice(0, 5).map((c: any) => ({
          id: c.customerId,
          name: c.name,
          ltv: c.lifetimeValue,
          lastVisitDays: c.recencyDays,
          suggestedAction: c.suggestedAction ?? null,
        })),
      };
    });

    res.json({ generatedAt: intel.generatedAt, cards });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/marketing/cache/invalidate ─────────────────────────────────────
export const invalidateCache = (_req: Request, res: Response) => {
  cache = null;
  res.json({ message: 'Marketing intelligence cache cleared.' });
};

// ── GET /api/marketing/opportunities ─────────────────────────────────────────
export const getOpportunities = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const intel = await getIntelligence();
    res.json({
      generatedAt: intel.generatedAt,
      count: intel.opportunities.length,
      opportunities: intel.opportunities,
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/marketing/generate-copy ────────────────────────────────────────
const VALID_CAMPAIGN_TYPES = ['recovery', 'upgrade', 'launch', 'festival', 'birthday', 'custom'] as const;
const VALID_CHANNELS = ['whatsapp', 'sms', 'email', 'manual'] as const;
const VALID_SEGMENT_KEYS = [
  'new', 'vip', 'lost', 'atRisk', 'highDiscount', 'crossSell',
  'fragranceNeverOptical', 'eyeTestDue', 'cheapFrameUpgrade',
  'blueCutUpgrade', 'premiumPerfumeUpgrade', 'inactive120', 'birthdayThisMonth',
] as const;

export const generateCopy = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { campaignType, channel, segmentKey, tone, extraInstructions } = req.body;

    if (!VALID_CAMPAIGN_TYPES.includes(campaignType)) {
      res.status(400).json({ message: `campaignType must be one of: ${VALID_CAMPAIGN_TYPES.join(', ')}` });
      return;
    }
    if (!VALID_CHANNELS.includes(channel)) {
      res.status(400).json({ message: `channel must be one of: ${VALID_CHANNELS.join(', ')}` });
      return;
    }
    if (!VALID_SEGMENT_KEYS.includes(segmentKey)) {
      res.status(400).json({ message: `segmentKey must be one of: ${VALID_SEGMENT_KEYS.join(', ')}` });
      return;
    }

    const result = await generateCampaignCopy({ campaignType, channel, segmentKey, tone, extraInstructions });
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      res.status(503).json({ message: 'AI copy generation is not configured on this server.' });
      return;
    }
    next(err);
  }
};
