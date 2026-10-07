import { Invoice } from '../models/Invoice.model';
import { Customer } from '../models/Customer.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Frame } from '../models/Frame.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { Fragrance } from '../models/Fragrance.model';
import { Prescription } from '../models/Prescription.model';
import { MarketingEvent } from '../models/MarketingEvent.model';
import { getDb } from '../lib/firestoreDb';
import { recordReads } from '../lib/readMeter';

// Ensure models are registered
const _m = [Invoice, Customer, InvoiceItem, Frame, OpticalLens, Fragrance, Prescription, MarketingEvent];

export const STORE_MAPS_LINK = 'https://maps.app.goo.gl/dpwXnG3nhBd6gWv29?g_st=ac';

export type RecallType = '4_month_tuneup' | '12_month_eye_test' | 'fragrance_refill';

export interface RecallCustomerItem {
  customerId: string;
  name: string;
  phone: string;
  lastBillDate: string;
  daysElapsed: number;
  lastItemSummary: string;
  waLink: string;
  messageText: string;
  recallType: RecallType;
  isContacted: boolean;
  lastContactedAt?: string | null;
  lastContactType?: string | null;
}

export interface RecallTasksResponse {
  generatedAt: string;
  storeMapsLink: string;
  tuneupRecalls: RecallCustomerItem[];
  annualEyeTestRecalls: RecallCustomerItem[];
  fragranceRecalls: RecallCustomerItem[];
  counts: {
    tuneupCount: number;
    annualEyeTestCount: number;
    fragranceCount: number;
    totalDue: number;
    contactedThisMonthCount: number;
  };
}

const cleanPhone = (raw: string): string => (raw || '').replace(/\D/g, '');

const prependCountryCode = (phone: string): string => {
  const digits = cleanPhone(phone);
  if (digits.startsWith('91') && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const buildWaLink = (phone: string, message: string): string => {
  const intlPhone = prependCountryCode(phone);
  return `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;
};

const diffInDays = (d1: Date, d2: Date) => {
  return Math.floor((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24));
};

// ── Snapshot ─────────────────────────────────────────────────────────────────
//
// Recalls need every invoice of the last 455 days plus its items and customer (about 2,700 reads),
// and an in-memory cache is lost on every Cloud Function cold start. The computed result is
// therefore stored in Firestore (snapshots/recalls) and reused for the rest of the day: one read
// per request instead of a full recompute. "Mark sent" and "snooze" patch the stored copy in place.

const SNAPSHOT_COLLECTION = 'snapshots';
const SNAPSHOT_DOC = 'recalls';
const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SNAPSHOT_MAX_BYTES = 900_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const istDay = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

// Short in-memory layer on top of the stored snapshot, to absorb repeated calls on one instance.
let cachedRecalls: { data: RecallTasksResponse; expiresAt: number; refTime: number } | null = null;
const RECALL_CACHE_TTL_MS = 5 * 60 * 1000;

export const invalidateRecallCache = () => {
  cachedRecalls = null;
};

async function loadSnapshot(): Promise<{ data: RecallTasksResponse; computedAt: number } | null> {
  const snap = await getDb().collection(SNAPSHOT_COLLECTION).doc(SNAPSHOT_DOC).get();
  recordReads(SNAPSHOT_COLLECTION, 1);
  if (!snap.exists) return null;
  const doc = snap.data() as { payload?: string; computedAt?: { toMillis?: () => number } | Date } | undefined;
  if (!doc?.payload) return null;
  const computedAt =
    doc.computedAt instanceof Date ? doc.computedAt.getTime() : (doc.computedAt as any)?.toMillis?.() ?? 0;
  try {
    return { data: JSON.parse(doc.payload) as RecallTasksResponse, computedAt };
  } catch {
    return null;
  }
}

async function saveSnapshot(data: RecallTasksResponse, computedAt = Date.now()): Promise<void> {
  const payload = JSON.stringify(data);
  if (Buffer.byteLength(payload) > SNAPSHOT_MAX_BYTES) {
    console.warn('[recalls] snapshot too large to store; serving computed result only');
    return;
  }
  await getDb()
    .collection(SNAPSHOT_COLLECTION)
    .doc(SNAPSHOT_DOC)
    .set({ payload, computedAt: new Date(computedAt) });
}

export const getCustomerRecalls = async (referenceDate: Date = new Date(), forceRefresh = false): Promise<RecallTasksResponse> => {
  const now = Date.now();
  const refTime = referenceDate.getTime();
  const isLiveRequest = Math.abs(refTime - now) < 3_600_000; // a custom ?date= bypasses the snapshot

  if (!forceRefresh && isLiveRequest) {
    if (cachedRecalls && cachedRecalls.expiresAt > now && Math.abs(cachedRecalls.refTime - refTime) < 3_600_000) {
      return cachedRecalls.data;
    }
    const stored = await loadSnapshot();
    if (stored && now - stored.computedAt < SNAPSHOT_MAX_AGE_MS && istDay(stored.computedAt) === istDay(now)) {
      cachedRecalls = { data: stored.data, expiresAt: now + RECALL_CACHE_TTL_MS, refTime };
      return stored.data;
    }
  }

  const response = await computeRecalls(referenceDate);
  if (isLiveRequest) {
    cachedRecalls = { data: response, expiresAt: now + RECALL_CACHE_TTL_MS, refTime };
    await saveSnapshot(response, now).catch((err) => console.warn('[recalls] could not store snapshot:', err?.message));
  }
  return response;
};

const countsFor = (
  tuneup: RecallCustomerItem[],
  annual: RecallCustomerItem[],
  fragrance: RecallCustomerItem[],
  contactedThisMonthCount: number,
): RecallTasksResponse['counts'] => {
  const open = (list: RecallCustomerItem[]) => list.filter((r) => !r.isContacted).length;
  return {
    tuneupCount: open(tuneup),
    annualEyeTestCount: open(annual),
    fragranceCount: open(fragrance),
    totalDue: open(tuneup) + open(annual) + open(fragrance),
    contactedThisMonthCount,
  };
};

/** Applies a "mark sent" or "snooze" to the stored snapshot without recomputing it. */
async function patchSnapshot(customerId: string, change: { contacted?: { type: RecallType; at: Date }; snoozed?: boolean }) {
  try {
    const stored = await loadSnapshot();
    if (!stored) return;
    const data = stored.data;
    const lists = [data.tuneupRecalls, data.annualEyeTestRecalls, data.fragranceRecalls];
    let contactedThisMonthCount = data.counts.contactedThisMonthCount;

    if (change.snoozed) {
      data.tuneupRecalls = data.tuneupRecalls.filter((r) => r.customerId !== customerId);
      data.annualEyeTestRecalls = data.annualEyeTestRecalls.filter((r) => r.customerId !== customerId);
      data.fragranceRecalls = data.fragranceRecalls.filter((r) => r.customerId !== customerId);
    }
    if (change.contacted) {
      const { type, at } = change.contacted;
      const mine = lists.flat().filter((r) => r.customerId === customerId);
      const wasRecentlyContacted = mine.some(
        (r) => r.lastContactedAt && Date.now() - new Date(r.lastContactedAt).getTime() <= 30 * 86_400_000,
      );
      for (const r of mine) {
        r.lastContactedAt = at.toISOString();
        r.lastContactType = type;
        r.isContacted = r.recallType === type;
      }
      if (mine.length > 0 && !wasRecentlyContacted) contactedThisMonthCount++;
    }

    data.counts = countsFor(data.tuneupRecalls, data.annualEyeTestRecalls, data.fragranceRecalls, contactedThisMonthCount);
    await saveSnapshot(data, stored.computedAt);
  } catch (err: any) {
    console.warn('[recalls] could not patch snapshot:', err?.message);
  }
}

const computeRecalls = async (referenceDate: Date): Promise<RecallTasksResponse> => {
  const refTime = referenceDate.getTime();

  // Maximum recall lookback is 450 days (annual eye test window: 330 to 450 days).
  // Strict date bound: NEVER load historical invoices older than 455 days.
  const minDate = new Date(refTime - 455 * 86_400_000);

  const invoices: any[] = await Invoice.find({ billDate: { $gte: minDate } })
    .select('customer items billDate createdAt')
    .populate('customer', 'name mobileNumber phone lastContactedAt lastContactType snoozedUntil')
    .populate({
      path: 'items',
      select: 'frame opticalLens fragrance prescription lensBrand lensName frameVariantLabel type price spherical rightEyeNumber',
    })
    .sort({ billDate: -1 })
    .lean();

  type CustAggregate = {
    customerId: string;
    name: string;
    phone: string;
    lastContactedAt?: Date | null;
    lastContactType?: string | null;
    snoozedUntil?: Date | null;
    lastAnyBillDate: Date;
    lastOpticalBillDate: Date | null;
    lastOpticalItemSummary: string;
    lastFragranceBillDate: Date | null;
    lastFragranceItemSummary: string;
  };

  const customerMap = new Map<string, CustAggregate>();

  for (const inv of invoices) {
    const cust = inv.customer;
    if (!cust?._id) continue;
    const cid = String(cust._id);
    const billDate = new Date(inv.billDate || inv.createdAt);

    let hasOptical = false;
    let opticalSummaryParts: string[] = [];
    let hasFragrance = false;
    let fragranceSummaryParts: string[] = [];

    for (const item of (inv.items || [])) {
      if (item.frame || item.type === 'frame') {
        hasOptical = true;
        opticalSummaryParts.push(item.frameVariantLabel || 'Frame');
      }
      if (item.opticalLens || item.lensBrand || item.lensName || item.type === 'lens') {
        hasOptical = true;
        opticalSummaryParts.push(item.lensBrand || item.lensName || 'Lenses');
      }
      if (item.prescription || (item.spherical !== null && item.spherical !== undefined) || item.rightEyeNumber) {
        hasOptical = true;
      }
      if (item.fragrance || item.type === 'fragrance') {
        hasFragrance = true;
        fragranceSummaryParts.push(item.fragranceVariantLabel || 'Perfume / Attar');
      }
    }

    const entry = customerMap.get(cid) ?? {
      customerId: cid,
      name: cust.name || 'Valued Customer',
      phone: cust.mobileNumber || cust.phone || '',
      lastContactedAt: cust.lastContactedAt ? new Date(cust.lastContactedAt) : null,
      lastContactType: cust.lastContactType || null,
      snoozedUntil: cust.snoozedUntil ? new Date(cust.snoozedUntil) : null,
      lastAnyBillDate: billDate,
      lastOpticalBillDate: null,
      lastOpticalItemSummary: '',
      lastFragranceBillDate: null,
      lastFragranceItemSummary: '',
    };

    if (billDate > entry.lastAnyBillDate) {
      entry.lastAnyBillDate = billDate;
    }

    if (hasOptical) {
      if (!entry.lastOpticalBillDate || billDate > entry.lastOpticalBillDate) {
        entry.lastOpticalBillDate = billDate;
        entry.lastOpticalItemSummary = opticalSummaryParts.slice(0, 2).join(' + ') || 'Optical Glasses';
      }
    }

    if (hasFragrance) {
      if (!entry.lastFragranceBillDate || billDate > entry.lastFragranceBillDate) {
        entry.lastFragranceBillDate = billDate;
        entry.lastFragranceItemSummary = fragranceSummaryParts.slice(0, 2).join(', ') || 'Perfume / Attar';
      }
    }

    customerMap.set(cid, entry);
  }

  const tuneupRecalls: RecallCustomerItem[] = [];
  const annualEyeTestRecalls: RecallCustomerItem[] = [];
  const fragranceRecalls: RecallCustomerItem[] = [];
  let contactedCount = 0;

  for (const entry of customerMap.values()) {
    if (!entry.phone) continue;

    // Check if snoozed
    if (entry.snoozedUntil && entry.snoozedUntil > referenceDate) {
      continue;
    }

    const daysSinceAnyBill = diffInDays(referenceDate, entry.lastAnyBillDate);

    // Rule: Exclude active customers who shopped within the last 30 days
    if (daysSinceAnyBill <= 30) continue;

    // Check contact cooldown (30 days)
    const daysSinceContact = entry.lastContactedAt
      ? diffInDays(referenceDate, entry.lastContactedAt)
      : 9999;
    const isRecentlyContacted = daysSinceContact <= 30;
    if (isRecentlyContacted) contactedCount++;

    // ── 1. 4-Month Frame Spa / Tune-Up (110 to 180 days) ─────────────────────
    if (entry.lastOpticalBillDate) {
      const daysSinceLastOptical = diffInDays(referenceDate, entry.lastOpticalBillDate);

      if (daysSinceLastOptical >= 110 && daysSinceLastOptical <= 180) {
        const msg = `Hi ${entry.name}, it has been 4 months since your last eyewear purchase at Attarwala Optical! 👓✨

Frames naturally loosen and lose alignment over time. Drop by this week for a complimentary ultrasonic lens wash, screw tightening, and frame alignment!

📍 Store Location: ${STORE_MAPS_LINK}
(Bring a family member along for a free 2-min vision screening while you wait!)`;

        tuneupRecalls.push({
          customerId: entry.customerId,
          name: entry.name,
          phone: entry.phone,
          lastBillDate: entry.lastOpticalBillDate.toISOString(),
          daysElapsed: daysSinceLastOptical,
          lastItemSummary: entry.lastOpticalItemSummary || 'Eyewear Frame/Lenses',
          messageText: msg,
          waLink: buildWaLink(entry.phone, msg),
          recallType: '4_month_tuneup',
          isContacted: isRecentlyContacted && entry.lastContactType === '4_month_tuneup',
          lastContactedAt: entry.lastContactedAt ? entry.lastContactedAt.toISOString() : null,
          lastContactType: entry.lastContactType,
        });
      }

      // ── 2. 12-Month Annual Vision Check (330 to 450 days) ───────────────────
      if (daysSinceLastOptical >= 330 && daysSinceLastOptical <= 450) {
        const msg = `Hi ${entry.name}, your annual eye prescription checkup is now due at Attarwala Optical! 👁️

Vision powers shift subtly over a year. Stop by this week for your free 5-minute digital vision re-test! Your previous prescription is securely saved in our records.

📍 Store Location: ${STORE_MAPS_LINK}`;

        annualEyeTestRecalls.push({
          customerId: entry.customerId,
          name: entry.name,
          phone: entry.phone,
          lastBillDate: entry.lastOpticalBillDate.toISOString(),
          daysElapsed: daysSinceLastOptical,
          lastItemSummary: entry.lastOpticalItemSummary || 'Prescription Glasses',
          messageText: msg,
          waLink: buildWaLink(entry.phone, msg),
          recallType: '12_month_eye_test',
          isContacted: isRecentlyContacted && entry.lastContactType === '12_month_eye_test',
          lastContactedAt: entry.lastContactedAt ? entry.lastContactedAt.toISOString() : null,
          lastContactType: entry.lastContactType,
        });
      }
    }

    // ── 3. Fragrance Refill & Seasonal Sample (90 to 160 days / 3–5 months) ───
    if (entry.lastFragranceBillDate) {
      const daysSinceFragrance = diffInDays(referenceDate, entry.lastFragranceBillDate);

      if (daysSinceFragrance >= 90 && daysSinceFragrance <= 160) {
        const msg = `Hi ${entry.name}, it has been about 3–4 months since your last fragrance visit at Attarwala! 🌸

Your favorite bottle might be running low. Drop by this week to top up your bottle or explore our new seasonal luxury attar & perfume arrivals — and receive a complimentary 3ml luxury tester sample on us!

📍 Store Location: ${STORE_MAPS_LINK}
(P.S. Get a free 2-min digital eye checkup while you test our new perfumes!)`;

        fragranceRecalls.push({
          customerId: entry.customerId,
          name: entry.name,
          phone: entry.phone,
          lastBillDate: entry.lastFragranceBillDate.toISOString(),
          daysElapsed: daysSinceFragrance,
          lastItemSummary: entry.lastFragranceItemSummary || 'Perfume / Attar',
          messageText: msg,
          waLink: buildWaLink(entry.phone, msg),
          recallType: 'fragrance_refill',
          isContacted: isRecentlyContacted && entry.lastContactType === 'fragrance_refill',
          lastContactedAt: entry.lastContactedAt ? entry.lastContactedAt.toISOString() : null,
          lastContactType: entry.lastContactType,
        });
      }
    }
  }

  tuneupRecalls.sort((a, b) => b.daysElapsed - a.daysElapsed);
  annualEyeTestRecalls.sort((a, b) => b.daysElapsed - a.daysElapsed);
  fragranceRecalls.sort((a, b) => b.daysElapsed - a.daysElapsed);

  const response: RecallTasksResponse = {
    generatedAt: referenceDate.toISOString(),
    storeMapsLink: STORE_MAPS_LINK,
    tuneupRecalls,
    annualEyeTestRecalls,
    fragranceRecalls,
    counts: {
      tuneupCount: tuneupRecalls.filter(r => !r.isContacted).length,
      annualEyeTestCount: annualEyeTestRecalls.filter(r => !r.isContacted).length,
      fragranceCount: fragranceRecalls.filter(r => !r.isContacted).length,
      totalDue:
        tuneupRecalls.filter(r => !r.isContacted).length +
        annualEyeTestRecalls.filter(r => !r.isContacted).length +
        fragranceRecalls.filter(r => !r.isContacted).length,
      contactedThisMonthCount: contactedCount,
    }
  };

  return response;
};

export const markCustomerRecallSent = async (
  customerId: string,
  recallType: RecallType,
  notes?: string
) => {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new Error('Customer not found');

  customer.lastContactedAt = new Date();
  customer.lastContactType = recallType;
  if (notes) {
    customer.notes = customer.notes ? `${customer.notes} | ${notes}` : notes;
  }
  await customer.save();
  invalidateRecallCache();
  await patchSnapshot(customerId, { contacted: { type: recallType, at: customer.lastContactedAt as Date } });

  await MarketingEvent.create({
    eventType: 'message_sent',
    customerId: customer._id,
    payload: {
      channel: 'manual_whatsapp',
      recallType,
      contactedAt: new Date(),
    }
  });

  return { success: true, customerId, contactedAt: customer.lastContactedAt };
};

export const snoozeCustomerRecall = async (customerId: string, days = 14) => {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new Error('Customer not found');

  customer.snoozedUntil = new Date(Date.now() + days * 86400000);
  await customer.save();
  invalidateRecallCache();
  await patchSnapshot(customerId, { snoozed: true });

  return { success: true, customerId, snoozedUntil: customer.snoozedUntil };
};
