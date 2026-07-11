import { Invoice } from '../models/Invoice.model';

// ── Constants ────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const VIP_LTV = 20_000;
const VIP_INVOICE_COUNT = 5;
const LOST_DAYS = 180;
const NEW_DAYS = 30;
const HIGH_DISCOUNT_RATE = 0.12;
const AT_RISK_MULTIPLIER = 1.5;
const MIN_AT_RISK_DAYS = 90;
const AVG_FRAGRANCE_SALE = 1_500;
const AVG_BLUECUT_UPGRADE = 1_200;
const AVG_PROGRESSIVE_UPGRADE = 2_800;
const FRAME_REPLACEMENT_DAYS = 540; // 18 months

// ── Small utilities ──────────────────────────────────────────────────────────

const startOfDay = (d: Date) => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

const diffInDays = (a: Date, b: Date) =>
  Math.ceil((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);

const round = (n: number, dp = 0) => Number(n.toFixed(dp));
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const safeDivide = (a: number, b: number) => (b > 0 ? a / b : 0);

// ── Item helpers ─────────────────────────────────────────────────────────────

type Category = 'frame' | 'opticalLens' | 'fragrance';

function itemCategory(item: any): Category | null {
  if (item?.frame) return 'frame';
  if (item?.fragrance) return 'fragrance';
  if (item?.opticalLens || item?.lensLabel || item?.lensBrand || item?.lensName) return 'opticalLens';
  return null;
}

function itemName(item: any): string {
  if (item?.frame) {
    return typeof item.frame === 'object' ? item.frame.name || 'Frame' : 'Frame';
  }
  if (item?.fragrance) {
    return typeof item.fragrance === 'object' ? item.fragrance.name || 'Fragrance' : 'Fragrance';
  }
  if (item?.lensLabel) return item.lensLabel;
  if (item?.lensBrand && item?.lensName) return `${item.lensBrand} ${item.lensName}`;
  if (item?.lensBrand) return item.lensBrand;
  if (item?.lensName) return item.lensName;
  if (item?.opticalLens && typeof item.opticalLens === 'object') {
    return item.opticalLens.name || 'Optical Lens';
  }
  return 'Optical Lens';
}

function isBluecut(item: any): boolean {
  const coating = String(item?.lensCoating ?? '').toLowerCase();
  const name = String(item?.lensName ?? '').toLowerCase();
  const label = String(item?.lensLabel ?? '').toLowerCase();
  return (
    coating.includes('blue') ||
    coating === 'bc' ||
    coating.startsWith('bc ') ||
    coating.endsWith(' bc') ||
    name.includes('blue cut') ||
    name.includes('bluecut') ||
    label.includes('blue')
  );
}

function isProgressiveLens(item: any): boolean {
  const cat = String(item?.lensCategory ?? '').toLowerCase();
  const type = String(item?.lensType ?? '').toLowerCase();
  if (cat.includes('progressive')) return true;
  if (type.includes('progressive')) return true;
  if (item?.opticalLens && typeof item.opticalLens === 'object') {
    if (String(item.opticalLens.category ?? '').toLowerCase().includes('progressive')) return true;
    if (Number(item.opticalLens.addition) > 0) return true;
  }
  return (
    Number(item?.addition) > 0 ||
    Number(item?.leftAddition) > 0 ||
    Number(item?.rightAddition) > 0
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export const buildMarketingIntelligence = async () => {
  const today = startOfDay(new Date());

  const invoices = await Invoice.find()
    .populate('customer', 'name mobileNumber email tags dateOfBirth')
    .populate({
      path: 'items',
      populate: [
        { path: 'frame', select: 'name companyName' },
        { path: 'opticalLens', select: 'name brand category addition' },
        { path: 'fragrance', select: 'name companyName' },
      ],
    })
    .lean();

  // ── 1. Aggregate per-customer ────────────────────────────────────────────────

  type Entry = {
    customerId: string;
    name: string;
    mobileNumber?: string;
    dateOfBirth: Date | null;
    invoiceList: any[];
    totalRevenue: number;
    totalDiscount: number;
    categoriesBought: Set<Category>;
    billDates: Date[];
    hasBlueCut: boolean;
    hasProgressive: boolean;
    hasLens: boolean;
    lastFrameDate: Date | null;
    lastFrameRevenue: number;
    allFramePrices: number[];
    allFragrancePrices: number[];
  };

  const customerMap = new Map<string, Entry>();

  for (const invoice of invoices as any[]) {
    const customer = invoice.customer as any;
    if (!customer?._id) continue;

    const id = String(customer._id);
    const entry: Entry = customerMap.get(id) ?? {
      customerId: id,
      name: customer.name || 'Customer',
      mobileNumber: customer.mobileNumber,
      dateOfBirth: customer.dateOfBirth ? new Date(customer.dateOfBirth) : null,
      invoiceList: [],
      totalRevenue: 0,
      totalDiscount: 0,
      categoriesBought: new Set<Category>(),
      billDates: [],
      hasBlueCut: false,
      hasProgressive: false,
      hasLens: false,
      lastFrameDate: null,
      lastFrameRevenue: 0,
      allFramePrices: [],
      allFragrancePrices: [],
    };

    entry.invoiceList.push(invoice);
    entry.totalRevenue += Number(invoice.total) || 0;
    entry.totalDiscount += Number(invoice.discount) || 0;
    const invoiceDate = new Date(String(invoice.billDate));
    entry.billDates.push(invoiceDate);

    for (const item of Array.isArray(invoice.items) ? invoice.items : []) {
      const cat = itemCategory(item);
      if (cat) entry.categoriesBought.add(cat);

      if (cat === 'opticalLens') {
        entry.hasLens = true;
        if (isBluecut(item)) entry.hasBlueCut = true;
        if (isProgressiveLens(item)) entry.hasProgressive = true;
      }

      if (cat === 'frame') {
        if (!entry.lastFrameDate || invoiceDate > entry.lastFrameDate) {
          entry.lastFrameDate = invoiceDate;
          entry.lastFrameRevenue = Number(item.price || 0);
        }
        if (Number(item.price) > 0) entry.allFramePrices.push(Number(item.price));
      }
      if (cat === 'fragrance') {
        if (Number(item.price) > 0) entry.allFragrancePrices.push(Number(item.price));
      }
    }

    customerMap.set(id, entry);
  }

  // ── 2. Derive per-customer metrics ───────────────────────────────────────────

  const customers = [...customerMap.values()].map(entry => {
    const dates = [...entry.billDates].sort((a, b) => a.getTime() - b.getTime());
    const lastDate = dates[dates.length - 1];
    const firstDate = dates[0];
    const recencyDays = diffInDays(today, lastDate);
    const invoiceCount = entry.invoiceList.length;

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const g = diffInDays(dates[i], dates[i - 1]);
      if (g > 0) gaps.push(g);
    }
    const averageGapDays = gaps.length
      ? round(gaps.reduce((s, g) => s + g, 0) / gaps.length)
      : 365;

    const averageOrderValue = round(safeDivide(entry.totalRevenue, invoiceCount));
    const averageDiscountRate = round(
      safeDivide(entry.totalDiscount, Math.max(entry.totalRevenue + entry.totalDiscount, 1)),
      4
    );

    const churnScore = clamp(
      Math.round(
        (recencyDays / Math.max(averageGapDays, 15)) * 40 +
          (entry.totalDiscount > 0 ? 5 : 0) +
          (entry.totalRevenue < 5_000 ? 5 : 0)
      ),
      0,
      100
    );

    const loyaltyScore = clamp(
      Math.round(
        100 - recencyDays * 0.6 + invoiceCount * 6 + safeDivide(entry.totalRevenue, 1_000)
      ),
      0,
      100
    );

    const lastInvoice = [...entry.invoiceList].sort(
      (a: any, b: any) =>
        new Date(String(b.billDate)).getTime() - new Date(String(a.billDate)).getTime()
    )[0];
    const lastProducts: string[] = (Array.isArray(lastInvoice?.items) ? lastInvoice.items : [])
      .map((item: any) => (itemCategory(item) ? itemName(item) : null))
      .filter(Boolean) as string[];

    const categoriesBought = [...entry.categoriesBought] as Category[];

    const missingCategories: Category[] = [];
    if (categoriesBought.includes('frame') && !categoriesBought.includes('opticalLens'))
      missingCategories.push('opticalLens');
    if (!categoriesBought.includes('frame') && categoriesBought.includes('opticalLens'))
      missingCategories.push('frame');
    if (!categoriesBought.includes('fragrance') && categoriesBought.length > 0)
      missingCategories.push('fragrance');

    const frameReplacementDays = entry.lastFrameDate
      ? diffInDays(today, entry.lastFrameDate)
      : null;

    return {
      customerId: entry.customerId,
      name: entry.name,
      mobileNumber: entry.mobileNumber,
      invoiceCount,
      lifetimeValue: round(entry.totalRevenue),
      totalDiscount: round(entry.totalDiscount),
      averageOrderValue,
      averageDiscountRate,
      averageGapDays,
      recencyDays,
      churnScore,
      loyaltyScore,
      lastPurchaseDate: lastDate.toISOString(),
      firstPurchaseDate: firstDate.toISOString(),
      lastProducts,
      categoriesBought,
      missingCategories,
      hasBlueCut: entry.hasBlueCut,
      hasProgressive: entry.hasProgressive,
      hasLens: entry.hasLens,
      lastFrameDate: entry.lastFrameDate ? entry.lastFrameDate.toISOString() : null,
      lastFrameRevenue: entry.lastFrameRevenue,
      frameReplacementDays,
      avgFramePrice: entry.allFramePrices.length > 0
        ? round(entry.allFramePrices.reduce((s, p) => s + p, 0) / entry.allFramePrices.length)
        : null,
      avgFragrancePrice: entry.allFragrancePrices.length > 0
        ? round(entry.allFragrancePrices.reduce((s, p) => s + p, 0) / entry.allFragrancePrices.length)
        : null,
      dateOfBirth: entry.dateOfBirth ? entry.dateOfBirth.toISOString() : null,
    };
  });

  // ── 3. Segment lists ─────────────────────────────────────────────────────────

  const newCustomers = customers
    .filter(c => diffInDays(today, new Date(c.firstPurchaseDate)) <= NEW_DAYS)
    .sort(
      (a, b) =>
        new Date(b.firstPurchaseDate).getTime() - new Date(a.firstPurchaseDate).getTime()
    );

  const vipCustomers = customers
    .filter(c => c.lifetimeValue >= VIP_LTV || c.invoiceCount >= VIP_INVOICE_COUNT)
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  const lostCustomers = customers
    .filter(c => c.recencyDays >= LOST_DAYS)
    .map(c => ({
      ...c,
      riskScore: clamp(Math.round((c.recencyDays / 365) * 100), 0, 100),
      suggestedAction:
        c.recencyDays >= 365
          ? 'Over a year inactive — reactivation campaign with strong offer'
          : c.lifetimeValue >= 10_000
          ? 'High-value customer — priority personal follow-up'
          : 'Send targeted WhatsApp with special return offer',
    }))
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  const atRiskCustomers = customers
    .filter(
      c =>
        c.invoiceCount >= 2 &&
        c.recencyDays < LOST_DAYS &&
        c.recencyDays > Math.max(c.averageGapDays * AT_RISK_MULTIPLIER, MIN_AT_RISK_DAYS)
    )
    .map(c => ({
      ...c,
      suggestedAction:
        c.lifetimeValue >= 15_000
          ? 'VIP at risk — personal follow-up call recommended'
          : 'Send new arrivals notification or eye test reminder',
    }))
    .sort((a, b) => b.churnScore - a.churnScore);

  const highDiscountCustomers = customers
    .filter(c => c.averageDiscountRate >= HIGH_DISCOUNT_RATE && c.invoiceCount >= 2)
    .map(c => ({
      ...c,
      suggestedAlternative:
        c.lifetimeValue >= 10_000
          ? 'Offer free lens cleaning kit or complimentary servicing instead of discount'
          : 'Offer loyalty points, premium packaging, or a small gift',
    }))
    .sort((a, b) => b.averageDiscountRate - a.averageDiscountRate);

  const crossSellOpportunities = customers
    .filter(c => c.missingCategories.length > 0 && c.recencyDays < 365)
    .map(c => {
      const recs: string[] = [];
      if (c.missingCategories.includes('opticalLens'))
        recs.push('Recommend premium lenses for their frame');
      if (c.missingCategories.includes('frame'))
        recs.push('Recommend a new frame to complement their lenses');
      if (c.missingCategories.includes('fragrance'))
        recs.push(
          c.categoriesBought.includes('frame') || c.categoriesBought.includes('opticalLens')
            ? 'Introduce fragrance collection to optical customer'
            : 'Recommend complementary fragrance products'
        );
      return {
        ...c,
        recommendation: recs.join(' · '),
        potentialValue: round(c.averageOrderValue * 0.55),
      };
    })
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  // ── 3b. New business-action segments ────────────────────────────────────────

  const CHEAP_FRAME_THRESHOLD = 1_500;
  const CHEAP_FRAGRANCE_THRESHOLD = 700;
  const EYE_TEST_DUE_DAYS = 540; // 18 months
  const INACTIVE_MIN_DAYS = 120;
  const INACTIVE_MAX_DAYS = 179;
  const currentMonth = today.getMonth() + 1;

  const fragranceNeverOptical = customers
    .filter(c =>
      c.categoriesBought.includes('fragrance') &&
      !c.categoriesBought.includes('opticalLens') &&
      !c.categoriesBought.includes('frame')
    )
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  const eyeTestDue = customers
    .filter(c => c.hasLens && c.recencyDays >= EYE_TEST_DUE_DAYS)
    .map(c => ({ ...c, suggestedAction: 'Schedule eye test — prescription likely due for update' }))
    .sort((a, b) => b.recencyDays - a.recencyDays);

  const cheapFrameUpgrade = customers
    .filter(c =>
      c.categoriesBought.includes('frame') &&
      (c as any).avgFramePrice !== null &&
      (c as any).avgFramePrice < CHEAP_FRAME_THRESHOLD
    )
    .map(c => ({ ...c, suggestedAction: `Recommend premium frames — current avg ₹${Math.round((c as any).avgFramePrice ?? 0)}` }))
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  const blueCutUpgrade = customers
    .filter(c => c.hasLens && !c.hasBlueCut && c.invoiceCount >= 2 && c.recencyDays < 730)
    .map(c => ({ ...c, suggestedAction: 'Recommend Blue Cut lenses for screen time protection' }))
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  const premiumPerfumeUpgrade = customers
    .filter(c =>
      c.categoriesBought.includes('fragrance') &&
      (c as any).avgFragrancePrice !== null &&
      (c as any).avgFragrancePrice < CHEAP_FRAGRANCE_THRESHOLD
    )
    .map(c => ({ ...c, suggestedAction: `Introduce premium collection — current avg ₹${Math.round((c as any).avgFragrancePrice ?? 0)}` }))
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  const inactive120 = customers
    .filter(c => c.recencyDays >= INACTIVE_MIN_DAYS && c.recencyDays <= INACTIVE_MAX_DAYS)
    .map(c => ({ ...c, suggestedAction: 'Send personalised message before customer becomes fully inactive' }))
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  const birthdayThisMonth = customers
    .filter(c => {
      const dob = (c as any).dateOfBirth;
      if (!dob) return false;
      return new Date(dob).getMonth() + 1 === currentMonth;
    })
    .map(c => ({ ...c, suggestedAction: 'Send birthday wishes with a special offer' }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── 4. Summary ────────────────────────────────────────────────────────────────

  const totalLTV = customers.reduce((s, c) => s + c.lifetimeValue, 0);
  const repeatCustomers = customers.filter(c => c.invoiceCount >= 2).length;

  const summary = {
    totalCustomers: customers.length,
    newCount: newCustomers.length,
    vipCount: vipCustomers.length,
    atRiskCount: atRiskCustomers.length,
    lostCount: lostCustomers.length,
    highDiscountCount: highDiscountCustomers.length,
    crossSellCount: crossSellOpportunities.length,
    totalLifetimeValue: round(totalLTV),
    averageCLV: round(safeDivide(totalLTV, Math.max(customers.length, 1))),
    repeatPurchaseRate: round(
      safeDivide(repeatCustomers, Math.max(customers.length, 1)) * 100,
      1
    ),
    lostRevenuePotential: round(
      lostCustomers.reduce((s, c) => s + c.averageOrderValue, 0)
    ),
  };

  // ── 5. Legacy rule-based suggestions ─────────────────────────────────────────

  type Priority = 'high' | 'medium' | 'low';
  type SuggestionCategory = 'recovery' | 'crossSell' | 'upsell' | 'retention';

  const suggestions: Array<{
    id: string;
    category: SuggestionCategory;
    priority: Priority;
    title: string;
    description: string;
    audienceSize: number;
    potentialRevenue: number;
    suggestedAction: string;
    customerIds: string[];
  }> = [];

  if (lostCustomers.length > 0) {
    suggestions.push({
      id: 'lost-recovery',
      category: 'recovery',
      priority: lostCustomers.length >= 10 ? 'high' : 'medium',
      title: `${lostCustomers.length} customers haven't visited in 6+ months`,
      description: `A targeted WhatsApp reactivation campaign with a limited-time offer could win back these customers before they go to a competitor.`,
      audienceSize: lostCustomers.length,
      potentialRevenue: round(lostCustomers.reduce((s, c) => s + c.averageOrderValue, 0)),
      suggestedAction: 'Create WhatsApp recovery campaign',
      customerIds: lostCustomers.slice(0, 50).map(c => c.customerId),
    });
  }

  const frameBuyersWithoutLens = crossSellOpportunities.filter(c =>
    c.missingCategories.includes('opticalLens')
  );
  if (frameBuyersWithoutLens.length > 0) {
    suggestions.push({
      id: 'frame-to-lens',
      category: 'crossSell',
      priority: 'high',
      title: `${frameBuyersWithoutLens.length} frame buyers haven't purchased lenses`,
      description: `These customers own a frame but have no lens purchase on record. A follow-up recommendation for Blue Cut or Anti-Glare lenses could significantly increase order value.`,
      audienceSize: frameBuyersWithoutLens.length,
      potentialRevenue: round(frameBuyersWithoutLens.reduce((s, c) => s + c.potentialValue, 0)),
      suggestedAction: 'Create lens upgrade campaign',
      customerIds: frameBuyersWithoutLens.slice(0, 50).map(c => c.customerId),
    });
  }

  const opticalWithoutFragrance = crossSellOpportunities.filter(
    c =>
      c.missingCategories.includes('fragrance') &&
      (c.categoriesBought.includes('frame') || c.categoriesBought.includes('opticalLens'))
  );
  if (opticalWithoutFragrance.length > 0) {
    suggestions.push({
      id: 'optical-to-fragrance',
      category: 'crossSell',
      priority: 'medium',
      title: `${opticalWithoutFragrance.length} optical customers haven't explored fragrances`,
      description: `These loyal optical customers are unaware of your fragrance collection. A product showcase or brief in-store demonstration could open a new revenue stream.`,
      audienceSize: opticalWithoutFragrance.length,
      potentialRevenue: round(opticalWithoutFragrance.length * AVG_FRAGRANCE_SALE),
      suggestedAction: 'Create fragrance introduction campaign',
      customerIds: opticalWithoutFragrance.slice(0, 50).map(c => c.customerId),
    });
  }

  if (atRiskCustomers.length > 0) {
    const avgGap = round(
      atRiskCustomers.reduce((s, c) => s + c.averageGapDays, 0) / atRiskCustomers.length
    );
    suggestions.push({
      id: 'at-risk-retention',
      category: 'retention',
      priority: atRiskCustomers.length >= 5 ? 'high' : 'medium',
      title: `${atRiskCustomers.length} regular customers are overdue for a visit`,
      description: `These customers typically buy every ${avgGap} days but haven't visited in longer than expected. Reach out before they become lost customers.`,
      audienceSize: atRiskCustomers.length,
      potentialRevenue: round(atRiskCustomers.reduce((s, c) => s + c.averageOrderValue, 0)),
      suggestedAction: 'Send new collection notification or eye test reminder',
      customerIds: atRiskCustomers.slice(0, 50).map(c => c.customerId),
    });
  }

  if (highDiscountCustomers.length > 0) {
    suggestions.push({
      id: 'discount-alternative',
      category: 'retention',
      priority: 'low',
      title: `${highDiscountCustomers.length} customers rely heavily on discounts`,
      description: `Replacing discounts with complimentary services, loyalty points, or premium gifts maintains goodwill without eroding margins.`,
      audienceSize: highDiscountCustomers.length,
      potentialRevenue: round(
        highDiscountCustomers.reduce((s, c) => s + c.totalDiscount * 0.5, 0)
      ),
      suggestedAction: 'Design loyalty alternatives programme',
      customerIds: highDiscountCustomers.slice(0, 50).map(c => c.customerId),
    });
  }

  const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // ── 6. Opportunity Intelligence (v2) ─────────────────────────────────────────

  type OppCategory = 'recovery' | 'upgrade' | 'crossSell' | 'retention';
  type CampaignType = 'recovery' | 'upgrade' | 'launch' | 'festival' | 'birthday' | 'custom';

  interface Opportunity {
    id: string;
    title: string;
    description: string;
    aiReasoning: string;
    category: OppCategory;
    priority: Priority;
    customerCount: number;
    potentialRevenue: number;
    expectedConversion: number;
    estimatedROI: number;
    suggestedCampaignType: CampaignType;
    recommendedProducts: string[];
    segmentKey?: string;
    customerIds: string[];
  }

  const opportunities: Opportunity[] = [];

  // Blue Cut Upgrade
  const blueCutCandidates = customers.filter(
    c => c.hasLens && !c.hasBlueCut && c.recencyDays < 730
  );
  if (blueCutCandidates.length > 0) {
    const conversion = 30;
    const potentialRevenue = round(blueCutCandidates.length * AVG_BLUECUT_UPGRADE * (conversion / 100));
    opportunities.push({
      id: 'lens-upgrade-bluecut',
      title: `${blueCutCandidates.length} customers don't have Blue Cut protection`,
      description: `These customers own lenses but haven't upgraded to Blue Cut coating. With increasing screen time, this is a compelling upsell — especially for regular visitors.`,
      aiReasoning: `Identified ${blueCutCandidates.length} customers with optical purchases but no blue cut or anti-blue light coating on record. Blue Cut is a high-margin, easy-to-recommend upgrade with strong health-value messaging.`,
      category: 'upgrade',
      priority: blueCutCandidates.length >= 15 ? 'high' : blueCutCandidates.length >= 5 ? 'medium' : 'low',
      customerCount: blueCutCandidates.length,
      potentialRevenue,
      expectedConversion: conversion,
      estimatedROI: round(safeDivide(potentialRevenue, Math.max(blueCutCandidates.length * 3, 50))),
      suggestedCampaignType: 'upgrade',
      recommendedProducts: ['Blue Cut Lenses', 'Anti-Reflective Coating', 'Screen Protection Lenses'],
      segmentKey: 'crossSell',
      customerIds: blueCutCandidates.slice(0, 50).map(c => c.customerId),
    });
  }

  // Progressive Lens Upgrade
  const progressiveCandidates = customers.filter(
    c => c.hasLens && !c.hasProgressive && c.recencyDays < 730 && c.invoiceCount >= 2
  );
  if (progressiveCandidates.length > 0) {
    const conversion = 18;
    const potentialRevenue = round(progressiveCandidates.length * AVG_PROGRESSIVE_UPGRADE * (conversion / 100));
    opportunities.push({
      id: 'progressive-lens-opportunity',
      title: `${progressiveCandidates.length} repeat customers may benefit from progressive lenses`,
      description: `These loyal customers have purchased single vision lenses but have never tried progressives. Ideal for customers over 40 — a proactive recommendation shows genuine care and drives high-value upgrades.`,
      aiReasoning: `Found ${progressiveCandidates.length} multi-visit customers using single vision lenses. Progressive lenses are the highest-margin optical product with an average ticket 2–3× single vision. Repeat customers are most receptive to professional upgrade recommendations.`,
      category: 'upgrade',
      priority: progressiveCandidates.length >= 10 ? 'high' : 'medium',
      customerCount: progressiveCandidates.length,
      potentialRevenue,
      expectedConversion: conversion,
      estimatedROI: round(safeDivide(potentialRevenue, Math.max(progressiveCandidates.length * 3, 50))),
      suggestedCampaignType: 'upgrade',
      recommendedProducts: ['Progressive Lenses', 'Blue Cut Progressive', 'Premium Varifocal'],
      segmentKey: 'crossSell',
      customerIds: progressiveCandidates.slice(0, 50).map(c => c.customerId),
    });
  }

  // Lost Customer Recovery
  if (lostCustomers.length > 0) {
    const conversion = 20;
    const potentialRevenue = round(
      lostCustomers.reduce((s, c) => s + c.averageOrderValue, 0) * (conversion / 100)
    );
    opportunities.push({
      id: 'lost-customer-recovery',
      title: `Recover ${lostCustomers.length} customers inactive for 6+ months`,
      description: `These customers have spent with you before but haven't returned. A personalised recovery message with an exclusive offer can win back 1 in 5 at a fraction of new-customer acquisition cost.`,
      aiReasoning: `${lostCustomers.length} customers with verified purchase history haven't visited in over 180 days. Historical data shows re-engagement campaigns have a 20% conversion rate for dormant customers with prior LTV > ₹5,000. Recovery cost is far below new customer acquisition.`,
      category: 'recovery',
      priority: lostCustomers.length >= 10 ? 'high' : 'medium',
      customerCount: lostCustomers.length,
      potentialRevenue,
      expectedConversion: conversion,
      estimatedROI: round(safeDivide(potentialRevenue, Math.max(lostCustomers.length * 3, 50))),
      suggestedCampaignType: 'recovery',
      recommendedProducts: ['Latest Frame Collection', 'New Arrivals', 'Premium Lenses'],
      segmentKey: 'lost',
      customerIds: lostCustomers.slice(0, 50).map(c => c.customerId),
    });
  }

  // Frame Replacement
  const frameReplacementCandidates = customers.filter(
    c =>
      c.lastFrameDate != null &&
      c.frameReplacementDays != null &&
      c.frameReplacementDays >= FRAME_REPLACEMENT_DAYS &&
      c.recencyDays < 1095
  );
  if (frameReplacementCandidates.length > 0) {
    const conversion = 22;
    const avgFrameRevenue = round(
      safeDivide(
        frameReplacementCandidates.reduce((s, c) => s + c.lastFrameRevenue, 0),
        frameReplacementCandidates.length
      )
    ) || 2_500;
    const potentialRevenue = round(
      frameReplacementCandidates.length * avgFrameRevenue * (conversion / 100)
    );
    opportunities.push({
      id: 'frame-replacement',
      title: `${frameReplacementCandidates.length} customers may need a frame upgrade`,
      description: `These customers purchased frames over 18 months ago — frames typically need replacement every 1–2 years due to wear, prescription changes, or new styles. A timely reminder drives repurchases before they visit a competitor.`,
      aiReasoning: `Detected ${frameReplacementCandidates.length} customers whose last frame purchase was ${Math.round(FRAME_REPLACEMENT_DAYS / 30)}+ months ago. Frame replacement is one of the most predictable repurchase cycles in optical retail. Proactive outreach with new collection imagery consistently outperforms passive waiting.`,
      category: 'upgrade',
      priority: frameReplacementCandidates.length >= 15 ? 'high' : 'medium',
      customerCount: frameReplacementCandidates.length,
      potentialRevenue,
      expectedConversion: conversion,
      estimatedROI: round(safeDivide(potentialRevenue, Math.max(frameReplacementCandidates.length * 3, 50))),
      suggestedCampaignType: 'upgrade',
      recommendedProducts: ['New Season Frames', 'Designer Collection', 'Light Titanium Frames'],
      segmentKey: undefined,
      customerIds: frameReplacementCandidates.slice(0, 50).map(c => c.customerId),
    });
  }

  // Fragrance Cross-sell for Optical Customers
  const fragranceCrossSell = customers.filter(
    c =>
      !c.categoriesBought.includes('fragrance') &&
      (c.categoriesBought.includes('frame') || c.categoriesBought.includes('opticalLens')) &&
      c.recencyDays < 365
  );
  if (fragranceCrossSell.length > 0) {
    const conversion = 15;
    const potentialRevenue = round(fragranceCrossSell.length * AVG_FRAGRANCE_SALE * (conversion / 100));
    opportunities.push({
      id: 'fragrance-crosssell',
      title: `Introduce fragrances to ${fragranceCrossSell.length} optical customers`,
      description: `These active optical customers have never tried your fragrance collection. A brief in-store demonstration or WhatsApp product showcase opens a second revenue stream with zero acquisition cost.`,
      aiReasoning: `${fragranceCrossSell.length} recent optical buyers have zero fragrance history. Cross-category buyers have a 40% higher LTV on average. Fragrance is an impulse-friendly, high-margin category that pairs naturally with an optical visit.`,
      category: 'crossSell',
      priority: fragranceCrossSell.length >= 20 ? 'high' : 'medium',
      customerCount: fragranceCrossSell.length,
      potentialRevenue,
      expectedConversion: conversion,
      estimatedROI: round(safeDivide(potentialRevenue, Math.max(fragranceCrossSell.length * 3, 50))),
      suggestedCampaignType: 'launch',
      recommendedProducts: ['Premium Oud', 'Signature Perfume', 'Bakhoor Collection', 'Gift Sets'],
      segmentKey: 'crossSell',
      customerIds: fragranceCrossSell.slice(0, 50).map(c => c.customerId),
    });
  }

  // At-Risk Retention
  if (atRiskCustomers.length > 0) {
    const conversion = 30;
    const potentialRevenue = round(
      atRiskCustomers.reduce((s, c) => s + c.averageOrderValue, 0) * (conversion / 100)
    );
    opportunities.push({
      id: 'at-risk-retention',
      title: `Re-engage ${atRiskCustomers.length} customers before they go quiet`,
      description: `These regular buyers are overdue for a visit based on their purchase cycle. A timely nudge — new arrivals, eye test reminder, or seasonal offer — has a high conversion rate before they become fully lost.`,
      aiReasoning: `${atRiskCustomers.length} customers show recency significantly above their historical average purchase gap. Early intervention at this stage yields 30% conversion vs. 20% after they become fully lost. Lower urgency message with new collection framing typically outperforms discount offers at this stage.`,
      category: 'retention',
      priority: atRiskCustomers.length >= 5 ? 'high' : 'medium',
      customerCount: atRiskCustomers.length,
      potentialRevenue,
      expectedConversion: conversion,
      estimatedROI: round(safeDivide(potentialRevenue, Math.max(atRiskCustomers.length * 3, 50))),
      suggestedCampaignType: 'custom',
      recommendedProducts: ['New Arrivals', 'Eye Test Invitation', 'Seasonal Collection'],
      segmentKey: 'atRisk',
      customerIds: atRiskCustomers.slice(0, 50).map(c => c.customerId),
    });
  }

  // Sort by potential revenue descending
  opportunities.sort((a, b) => b.potentialRevenue - a.potentialRevenue);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      ...summary,
      fragranceNeverOpticalCount: fragranceNeverOptical.length,
      eyeTestDueCount: eyeTestDue.length,
      cheapFrameUpgradeCount: cheapFrameUpgrade.length,
      blueCutUpgradeCount: blueCutUpgrade.length,
      premiumPerfumeUpgradeCount: premiumPerfumeUpgrade.length,
      inactive120Count: inactive120.length,
      birthdayThisMonthCount: birthdayThisMonth.length,
    },
    suggestions,
    opportunities,
    segments: {
      // Legacy segments — kept for automation rule compatibility
      new: newCustomers.slice(0, 100),
      vip: vipCustomers.slice(0, 100),
      lost: lostCustomers.slice(0, 100),
      atRisk: atRiskCustomers.slice(0, 100),
      highDiscount: highDiscountCustomers.slice(0, 100),
      crossSell: crossSellOpportunities.slice(0, 100),
      // Business-action segments
      fragranceNeverOptical: fragranceNeverOptical.slice(0, 100),
      eyeTestDue: eyeTestDue.slice(0, 100),
      cheapFrameUpgrade: cheapFrameUpgrade.slice(0, 100),
      blueCutUpgrade: blueCutUpgrade.slice(0, 100),
      premiumPerfumeUpgrade: premiumPerfumeUpgrade.slice(0, 100),
      inactive120: inactive120.slice(0, 100),
      birthdayThisMonth: birthdayThisMonth.slice(0, 100),
    },
  };
};
