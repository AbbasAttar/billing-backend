import { Invoice } from '../models/Invoice.model';
import { Customer } from '../models/Customer.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Frame } from '../models/Frame.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { Fragrance } from '../models/Fragrance.model';
import { Prescription } from '../models/Prescription.model';
import { MarketingEvent } from '../models/MarketingEvent.model';

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

export const getCustomerRecalls = async (referenceDate: Date = new Date()): Promise<RecallTasksResponse> => {
  const invoices: any[] = await Invoice.find()
    .populate({
      path: 'items',
      populate: [
        { path: 'frame' },
        { path: 'opticalLens' },
        { path: 'fragrance' },
        { path: 'prescription' },
      ]
    })
    .populate('customer')
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
      if (item.frame) {
        hasOptical = true;
        opticalSummaryParts.push(item.frame.name || item.frame.companyName || 'Frame');
      }
      if (item.opticalLens || item.lensBrand || item.lensName) {
        hasOptical = true;
        opticalSummaryParts.push(item.lensBrand || item.lensName || 'Lenses');
      }
      if (item.prescription || item.spherical !== null && item.spherical !== undefined || item.rightEyeNumber) {
        hasOptical = true;
      }
      if (item.fragrance) {
        hasFragrance = true;
        fragranceSummaryParts.push(item.fragrance.name || 'Perfume / Attar');
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

  return {
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

  return { success: true, customerId, snoozedUntil: customer.snoozedUntil };
};
