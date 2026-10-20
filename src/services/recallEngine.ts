import { Invoice } from '../models/Invoice.model';
import { Customer } from '../models/Customer.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Frame } from '../models/Frame.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { Fragrance } from '../models/Fragrance.model';
import { Prescription } from '../models/Prescription.model';
import { MarketingEvent } from '../models/MarketingEvent.model';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getDb } from '../lib/firestoreDb';
import { recordReads } from '../lib/readMeter';
import { isCatchAllFragrance, isWholesaleMixFragrance } from './catchAllProducts';

// Ensure models are registered
const _m = [Invoice, Customer, InvoiceItem, Frame, OpticalLens, Fragrance, Prescription, MarketingEvent];

export const STORE_MAPS_LINK = 'https://maps.app.goo.gl/dpwXnG3nhBd6gWv29?g_st=ac';

// ── Recall rules ─────────────────────────────────────────────────────────────
//
// Every recall counts from the customer's latest purchase in its category, so buying again
// cancels a pending recall and starts the next one from the new bill. Service recalls are
// phoned (trust, two-way: "the frame is loose"); sales pitches go on WhatsApp with photos and
// are phoned only when the customer replies.

export type RecallType =
  | 'frame_fit_check'
  | 'frame_maintenance'
  | 'eye_test'
  | 'frame_upgrade'
  | 'fragrance_refill'
  | 'fragrance_new';

export type RecallKind = 'service' | 'refill' | 'sales';
export type RecallChannel = 'call' | 'whatsapp';
/** 'auto' follows each recall's own channel (call for service, WhatsApp for sales pitches). */
export type ContactPreference = 'auto' | 'call' | 'whatsapp' | 'no_contact';
export type RecallOutcome =
  | 'visit_promised'
  | 'not_needed'
  | 'no_answer'
  | 'wrong_number'
  | 'do_not_contact'
  | 'whatsapp_sent';

export const RECALL_TYPES: RecallType[] = [
  'frame_fit_check',
  'frame_maintenance',
  'eye_test',
  'frame_upgrade',
  'fragrance_refill',
  'fragrance_new',
];
export const RECALL_OUTCOMES: RecallOutcome[] = [
  'visit_promised',
  'not_needed',
  'no_answer',
  'wrong_number',
  'do_not_contact',
  'whatsapp_sent',
];
export const CONTACT_PREFERENCES: ContactPreference[] = ['auto', 'call', 'whatsapp', 'no_contact'];

interface RecallRule {
  label: string;
  kind: RecallKind;
  channel: RecallChannel;
}

export const RECALL_RULES: Record<RecallType, RecallRule> = {
  frame_fit_check: { label: 'Frame fit check', kind: 'service', channel: 'call' },
  frame_maintenance: { label: '6-month frame service', kind: 'service', channel: 'call' },
  eye_test: { label: 'Yearly eye test', kind: 'service', channel: 'call' },
  frame_upgrade: { label: 'New frame (upgrade)', kind: 'sales', channel: 'whatsapp' },
  fragrance_refill: { label: 'Fragrance refill', kind: 'refill', channel: 'call' },
  fragrance_new: { label: 'New fragrance', kind: 'sales', channel: 'whatsapp' },
};

const KIND_PRIORITY: Record<RecallKind, number> = { service: 3, refill: 2, sales: 1 };

/** Days after the anchor purchase in which each recall is open. */
const WINDOWS = {
  frame_fit_check: [7, 20],
  frame_maintenance: [165, 220],
  eye_test: [330, 420],
  frame_upgrade: [540, 760],
} as const;

/** Bills older than this are never loaded (the frame-upgrade window ends at 760 days). */
const LOOKBACK_DAYS = 765;
/** At most one contact per customer in this many days, across all recall types. */
const CONTACT_GAP_DAYS = 30;
/** Calls staff are asked to make per day; the rest wait for the next days. */
export const DAILY_CALL_TARGET = 20;
/** After this many unanswered calls the recall moves to WhatsApp. */
const MAX_NO_ANSWER = 2;
/** Sales pitches skip customers who bought anything this recently. */
const SALES_QUIET_DAYS = 30;

/** Usual days for a fragrance to run out, by type (one unit); tuned once repeat data builds up. */
const REFILL_DAYS_BY_TYPE: Record<string, number> = {
  attar: 45,
  perfume: 75,
  bakhoor: 40,
  'body spray': 45,
  essence: 45,
};
const REFILL_DEFAULT_DAYS = 60;
/** Refill window: from a few days before the expected day until this long after it. */
const REFILL_EARLY_DAYS = 5;
const REFILL_LATE_DAYS = 45;
const FRAGRANCE_NEW_MAX_DAYS = 400;

// ── Response types ───────────────────────────────────────────────────────────

export type RecallItemKind = 'frame' | 'lens' | 'fragrance' | 'other';

/** One line of a past bill, as shown in the recall row's purchase history. */
export interface RecallHistoryLine {
  kind: RecallItemKind;
  name: string;
  /** Grade / size for fragrances, lens type for lenses, colour / shape for frames. */
  detail?: string;
  quantity: number;
  price: number;
  fragranceId?: string;
}

export interface RecallHistoryInvoice {
  invoiceId: string;
  invoiceNumber?: string;
  billDate: string;
  total: number;
  items: RecallHistoryLine[];
}

/** A fragrance to pitch: one they bought before (refill) or a new arrival they have not tried. */
export interface RecallPitchProduct {
  fragranceId: string;
  name: string;
  detail?: string;
  /** Refill: times bought in the window. */
  timesBought?: number;
  /** Refill: last price paid; new: current retail price. */
  price?: number;
  lastBoughtAt?: string;
}

export interface RecallPitchMessage {
  messageText: string;
  waLink: string;
}

/** One customer to contact today, for their most important due recall. */
export interface RecallTask {
  customerId: string;
  name: string;
  phone: string;
  recallType: RecallType;
  kind: RecallKind;
  /** How to reach them today: the rule's channel, unless the customer prefers otherwise or missed calls. */
  channel: RecallChannel;
  label: string;
  /** Why they are due, in plain words ("Frame bought 12 days ago"). */
  reason: string;
  daysElapsed: number;
  lastBillDate: string;
  lastItemSummary: string;
  /** Other recalls due at the same time; handled in the same contact. */
  otherReasons: { recallType: RecallType; label: string }[];
  /** What to say on the call. */
  callScript: string;
  /** Full WhatsApp message for this recall. */
  messageText: string;
  waLink: string;
  /** Short WhatsApp after a call ("as discussed" + store location). */
  followUp: RecallPitchMessage;
  contactPreference: ContactPreference;
  noAnswerCount: number;
  lastOutcome?: RecallOutcome | null;
  lastContactedAt?: string | null;
  lastContactType?: string | null;
  /** Most recent bills (newest first) within the window, with their lines. */
  history: RecallHistoryInvoice[];
  /** Fragrance recalls: what to pitch, with a ready WhatsApp message for each option. */
  refillPicks?: RecallPitchProduct[];
  newPicks?: RecallPitchProduct[];
  refillPitch?: RecallPitchMessage | null;
  newPitch?: RecallPitchMessage | null;
}

export interface RecallTasksResponse {
  generatedAt: string;
  storeMapsLink: string;
  dailyCallTarget: number;
  /** Customers to phone, most important first. */
  calls: RecallTask[];
  /** Customers to message on WhatsApp. */
  messages: RecallTask[];
  /** Contacted in the last 30 days (with the outcome). */
  done: RecallTask[];
  counts: {
    calls: number;
    messages: number;
    done: number;
    /** Open tasks per recall type (calls + messages). */
    byType: Record<RecallType, number>;
  };
}

// ── Small helpers ────────────────────────────────────────────────────────────

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

const DAY_MS = 86_400_000;

const diffInDays = (d1: Date, d2: Date) => {
  return Math.floor((d1.getTime() - d2.getTime()) / DAY_MS);
};

const toDate = (v: any): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const idOf = (v: any): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  const id = v._id || v.id;
  return id ? String(id) : null;
};

const fragranceName = (f: any): string =>
  f?.name ? (f.companyName ? `${f.name} (${f.companyName})` : f.name) : 'Perfume / Attar';

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ── Purchase history & pitch helpers ─────────────────────────────────────────

const HISTORY_MAX_INVOICES = 5;
const HISTORY_MAX_LINES = 8;
const PITCH_MAX = 3;
/** Fragrances added within this many days count as "new arrivals" for the pitch. */
const NEW_ARRIVAL_DAYS = 120;

const isFrameLine = (item: any) => !!(item.frame || item.type === 'frame');
const isLensLine = (item: any) =>
  !!(
    item.opticalLens ||
    item.lensBrand ||
    item.lensName ||
    item.lensType ||
    item.type === 'lens' ||
    item.type === 'opticalLens' ||
    item.prescription ||
    (item.spherical !== null && item.spherical !== undefined) ||
    item.rightEyeNumber
  );
const isFragranceLine = (item: any) => {
  if (!(item.fragrance || item.type === 'fragrance')) return false;
  // Mixed wholesale orders are not a retail customer's bottle.
  return !(typeof item.fragrance === 'object' && isWholesaleMixFragrance(item.fragrance));
};

/** One bill line in plain words; null for lines that carry nothing to show. */
const historyLine = (item: any): RecallHistoryLine | null => {
  if (!item || typeof item !== 'object') return null;
  const quantity = Number(item.quantity) || 1;
  const price = Number(item.price) || 0;

  if (item.fragrance || item.type === 'fragrance') {
    const f = typeof item.fragrance === 'object' ? item.fragrance : null;
    return {
      kind: 'fragrance',
      name: fragranceName(f),
      detail: item.fragranceGrade || undefined,
      quantity,
      price,
      fragranceId: idOf(item.fragrance) ?? undefined,
    };
  }
  if (isFrameLine(item)) {
    const f = typeof item.frame === 'object' ? item.frame : null;
    const attrs = item.frameAttrs || {};
    return {
      kind: 'frame',
      name: f?.name ? [f.companyName, f.name].filter(Boolean).join(' ') : item.frameVariantLabel || 'Frame',
      detail: [item.frameVariantLabel && f?.name ? item.frameVariantLabel : null, attrs.color, attrs.shape]
        .filter(Boolean)
        .join(' · ') || undefined,
      quantity,
      price,
    };
  }
  if (item.opticalLens || item.lensBrand || item.lensName || item.lensType || item.type === 'lens' || item.type === 'opticalLens') {
    return {
      kind: 'lens',
      name: [item.lensBrand, item.lensName].filter(Boolean).join(' ') || 'Lenses',
      detail: item.lensType || item.lensCategory || undefined,
      quantity,
      price,
    };
  }
  if (item.itemName) return { kind: 'other', name: item.itemName, quantity, price };
  return null;
};

const inStock = (f: any): boolean =>
  (Number(f.stock) || 0) > 0 || (f.variants || []).some((v: any) => (Number(v.stock) || 0) > 0);

const retailPrice = (f: any): number | undefined => {
  const prices = (f.variants || []).map((v: any) => Number(v.sellPrice)).filter((p: number) => p > 0);
  if (prices.length > 0) return Math.min(...prices);
  return Number(f.sellPrice) || undefined;
};

/**
 * New arrivals to suggest: retail fragrances in stock that the customer has not bought, preferring
 * their usual type (attar / perfume…) and gender, newest first.
 */
const pickNewArrivals = (
  catalog: any[],
  bought: { fragranceId: string; type?: string; gender?: string }[],
  referenceDate: Date,
): RecallPitchProduct[] => {
  const boughtIds = new Set(bought.map((b) => b.fragranceId));
  const types = new Set(bought.map((b) => b.type).filter(Boolean));
  const genders = new Set(bought.map((b) => b.gender).filter(Boolean));
  const cutoff = referenceDate.getTime() - NEW_ARRIVAL_DAYS * DAY_MS;

  const score = (f: any) =>
    (types.has(f.type) ? 2 : 0) + (!f.gender || f.gender === 'unisex' || genders.size === 0 || genders.has(f.gender) ? 1 : 0);
  const added = (f: any) => toDate(f.createdAt)?.getTime() ?? 0;

  const candidates = catalog.filter(
    (f) =>
      f.type !== 'packaging' &&
      f.channels?.retail !== false &&
      !isCatchAllFragrance(f) &&
      !boughtIds.has(idOf(f) as string) &&
      inStock(f),
  );
  const recent = candidates.filter((f) => added(f) >= cutoff);
  const pool = recent.length >= PITCH_MAX ? recent : candidates;

  return pool
    .sort((a, b) => score(b) - score(a) || added(b) - added(a))
    .slice(0, PITCH_MAX)
    .map((f) => ({
      fragranceId: idOf(f) as string,
      name: fragranceName(f),
      detail: f.scent?.sellingLine || undefined,
      price: retailPrice(f),
    }));
};

const pitchLabel = (p: RecallPitchProduct) => (p.detail && p.timesBought ? `${p.name} – ${p.detail}` : p.name);

// ── Messages ────────────────────────────────────────────────────────────────

const SIGN_OFF = `Attarwala Optical House, Dahod
📍 ${STORE_MAPS_LINK}`;

const refillMessage = (name: string, picks: RecallPitchProduct[]) => `Assalamu Alaikum / Namaste ${name}! 🌸

Hope you are enjoying ${picks.map(pitchLabel).join(', ')} from Attarwala. Your bottle may be running low — we have it in stock and can keep it ready for you.

Reply "REFILL" and we'll pack it, or drop by and try a complimentary tester of our new arrivals.

${SIGN_OFF}`;

const newArrivalMessage = (name: string, last: RecallPitchProduct | undefined, picks: RecallPitchProduct[]) => `Assalamu Alaikum / Namaste ${name}! ✨

New fragrances just arrived at Attarwala.${last ? ` Since you enjoyed ${last.name}, we think you'll love:` : ' Handpicked for you:'}
${picks.map((p) => `• ${p.name}${p.price ? ` – from ₹${p.price}` : ''}`).join('\n')}

Visit us to try them, or reply and we'll suggest one for you.

${SIGN_OFF}`;

const followUpMessage = (name: string) => `Hi ${name}, as discussed on the call — here is our store location. See you soon!

${SIGN_OFF}`;

interface MessageContext {
  name: string;
  days: number;
  item: string;
  refillPicks: RecallPitchProduct[];
  newPicks: RecallPitchProduct[];
}

/** Call script (what staff say) and WhatsApp message for each recall type. */
const MESSAGES: Record<RecallType, (c: MessageContext) => { script: string; message: string }> = {
  frame_fit_check: (c) => ({
    script: `Namaste ${c.name}ji, Attarwala Optical se bol rahe hain. ${c.days} din pehle aapne ${c.item} liya tha — chashma theek fit ho raha hai? Naak ya kaan par dabav to nahi? Kabhi bhi aa jaiye, free adjustment kar denge.`,
    message: `Namaste ${c.name}! Thank you for choosing Attarwala Optical House. 👓

How are your new spectacles fitting? If they press on the nose or ears or slip down, visit us any time for a free adjustment.

${SIGN_OFF}`,
  }),
  frame_maintenance: (c) => ({
    script: `Namaste ${c.name}ji, Attarwala Optical se. Aapke chashme ko 6 mahine ho gaye — screw tight, nose-pad aur ultrasonic cleaning free mein kar dete hain. Is hafte kab aa sakte hain?`,
    message: `Namaste ${c.name}! It has been about 6 months since you bought your spectacles from Attarwala Optical House. 👓

Visit us for a complimentary screw tightening, nose-pad check and ultrasonic cleaning — it takes just a few minutes.

${SIGN_OFF}`,
  }),
  eye_test: (c) => ({
    script: `Namaste ${c.name}ji, Attarwala Optical se. Aapka last eye checkup lagbhag ek saal pehle hua tha — number badal sakta hai. Free eye test ke liye is hafte aa jaiye, aapka purana record hamare paas hai.`,
    message: `Namaste ${c.name}! Your yearly eye check-up is due at Attarwala Optical House. 👁️

Vision can change over a year. Visit us for a free eye test — your previous prescription is saved with us.

${SIGN_OFF}`,
  }),
  frame_upgrade: (c) => ({
    script: `Namaste ${c.name}ji, Attarwala Optical se. Aapka chashma ab lagbhag ${Math.round(c.days / 30)} mahine purana hai — frame theek hai? Naye designs aaye hain, WhatsApp par photos bheje hain.`,
    message: `Namaste ${c.name}! It has been a while since you got your spectacles from Attarwala Optical House. 👓

Is your frame still in good shape? If you are thinking of a new look, our latest designs have arrived — reply and we'll send photos, or drop by to try them on.

${SIGN_OFF}`,
  }),
  fragrance_refill: (c) => ({
    script: `Assalamu Alaikum / Namaste ${c.name}ji, Attarwala se. Aapne ${c.refillPicks[0]?.name ?? c.item} liya tha — khatam hone wala hoga? Pack karke ready rakh dein? Naye attar bhi aaye hain, aakar try kar lijiye.`,
    message: c.refillPicks.length > 0 ? refillMessage(c.name, c.refillPicks) : refillMessage(c.name, [{ fragranceId: '', name: c.item }]),
  }),
  fragrance_new: (c) => ({
    script: `Assalamu Alaikum / Namaste ${c.name}ji, Attarwala se. Naye attar aur perfume aaye hain${c.newPicks[0] ? ` — jaise ${c.newPicks[0].name}` : ''}. WhatsApp par details bheji hain, kabhi aakar try kar lijiye.`,
    message:
      c.newPicks.length > 0
        ? newArrivalMessage(c.name, c.refillPicks[0], c.newPicks)
        : `Assalamu Alaikum / Namaste ${c.name}! ✨

Hope you are enjoying your fragrance from Attarwala. Looking for your next favourite scent? Visit us to explore our attars and perfumes, or reply for a recommendation.

${SIGN_OFF}`,
  }),
};

// ── Snapshot ─────────────────────────────────────────────────────────────────
//
// Recalls need every invoice of the lookback window plus its items and customer, and an
// in-memory cache is lost on every Cloud Function cold start. The computed result is therefore
// stored in Firestore (snapshots/recalls) and reused for the rest of the day: one read per
// request instead of a full recompute. Outcomes, preferences and snoozes patch the stored copy.

const SNAPSHOT_COLLECTION = 'snapshots';
const SNAPSHOT_DOC = 'recalls';
const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SNAPSHOT_MAX_BYTES = 900_000;
/** Bump when the response shape changes, so an older stored snapshot is recomputed. */
const SNAPSHOT_VERSION = 3;
// Stored gzipped (base64): the plain JSON is several hundred KB, close to the document size limit.
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
  const doc = snap.data() as { payload?: string; gz?: string; version?: number; computedAt?: { toMillis?: () => number } | Date } | undefined;
  if (!doc?.gz || doc.version !== SNAPSHOT_VERSION) return null;
  const computedAt =
    doc.computedAt instanceof Date ? doc.computedAt.getTime() : (doc.computedAt as any)?.toMillis?.() ?? 0;
  try {
    return { data: JSON.parse(gunzipSync(Buffer.from(doc.gz, 'base64')).toString('utf8')) as RecallTasksResponse, computedAt };
  } catch {
    return null;
  }
}

async function saveSnapshot(data: RecallTasksResponse, computedAt = Date.now()): Promise<void> {
  const gz = gzipSync(JSON.stringify(data)).toString('base64');
  if (gz.length > SNAPSHOT_MAX_BYTES) {
    console.warn('[recalls] snapshot too large to store; serving computed result only');
    return;
  }
  await getDb()
    .collection(SNAPSHOT_COLLECTION)
    .doc(SNAPSHOT_DOC)
    .set({ gz, version: SNAPSHOT_VERSION, computedAt: new Date(computedAt) });
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

const countsFor = (data: Pick<RecallTasksResponse, 'calls' | 'messages' | 'done'>): RecallTasksResponse['counts'] => {
  const byType = Object.fromEntries(RECALL_TYPES.map((t) => [t, 0])) as Record<RecallType, number>;
  for (const t of [...data.calls, ...data.messages]) byType[t.recallType]++;
  return { calls: data.calls.length, messages: data.messages.length, done: data.done.length, byType };
};

/** Applies a contact outcome, preference change or snooze to the stored snapshot without recomputing it. */
async function patchSnapshot(
  customerId: string,
  change:
    | { kind: 'outcome'; outcome: RecallOutcome; at: Date; recallType: RecallType; noAnswerCount: number }
    | { kind: 'preference'; preference: ContactPreference }
    | { kind: 'snooze' },
) {
  try {
    const stored = await loadSnapshot();
    if (!stored) return;
    const data = stored.data;
    const mine = (t: RecallTask) => t.customerId === customerId;
    const task = data.calls.find(mine) ?? data.messages.find(mine);
    data.calls = data.calls.filter((t) => !mine(t));
    data.messages = data.messages.filter((t) => !mine(t));

    if (change.kind === 'outcome' && task) {
      data.done = [
        {
          ...task,
          lastOutcome: change.outcome,
          lastContactedAt: change.at.toISOString(),
          lastContactType: change.recallType,
          noAnswerCount: change.noAnswerCount,
        },
        ...data.done.filter((t) => !mine(t)),
      ];
    }
    if (change.kind === 'preference' && task && change.preference !== 'no_contact') {
      const channel = channelFor(RECALL_RULES[task.recallType].channel, change.preference, task.noAnswerCount);
      const updated = { ...task, contactPreference: change.preference, channel };
      (channel === 'call' ? data.calls : data.messages).push(updated);
      sortTasks(data.calls);
      sortTasks(data.messages);
    }

    data.counts = countsFor(data);
    await saveSnapshot(data, stored.computedAt);
  } catch (err: any) {
    console.warn('[recalls] could not patch snapshot:', err?.message);
  }
}

// ── Computing the recall list ────────────────────────────────────────────────

const channelFor = (ruleChannel: RecallChannel, preference: ContactPreference, noAnswerCount: number): RecallChannel => {
  if (preference === 'whatsapp') return 'whatsapp';
  if (noAnswerCount >= MAX_NO_ANSWER) return 'whatsapp';
  if (preference === 'call') return 'call';
  return ruleChannel;
};

const taskPriority = (t: RecallTask) => KIND_PRIORITY[t.kind] * 10_000 + Math.min(t.daysElapsed, 9_999);

const sortTasks = (list: RecallTask[]) => list.sort((a, b) => taskPriority(b) - taskPriority(a));

/** Expected days until a fragrance runs out: the customer's own buying gap, else a default by type and quantity. */
export const expectedRefillDays = (purchaseDates: Date[], lastType?: string, lastQuantity = 1): number => {
  const days = [...new Set(purchaseDates.map((d) => Math.floor(d.getTime() / DAY_MS)))].sort((a, b) => a - b);
  if (days.length >= 2) {
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    return Math.round(Math.min(180, Math.max(20, median(gaps))));
  }
  const base = REFILL_DAYS_BY_TYPE[lastType ?? ''] ?? REFILL_DEFAULT_DAYS;
  const qty = Math.min(Math.max(1, lastQuantity), 4);
  return Math.round(base * (1 + 0.5 * (qty - 1)));
};

type CustAggregate = {
  customerId: string;
  name: string;
  phone: string;
  lastContactedAt: Date | null;
  lastContactType: string | null;
  lastOutcome: RecallOutcome | null;
  snoozedUntil: Date | null;
  nextAttemptAt: Date | null;
  contactPreference: ContactPreference;
  phoneInvalid: boolean;
  noAnswerCount: number;
  recallContacts: Partial<Record<RecallType, Date>>;
  lastAnyBillDate: Date;
  lastFrameBill: { date: Date; summary: string } | null;
  lastLensBill: { date: Date; summary: string } | null;
  lastFragranceBill: { date: Date; summary: string; type?: string; quantity: number } | null;
  fragranceBillDates: Date[];
  history: RecallHistoryInvoice[];
  /** Every fragrance bought in the window, keyed by fragrance id + grade. */
  fragrancesBought: Map<string, RecallPitchProduct & { type?: string; gender?: string }>;
};

const aggregateCustomers = (invoices: any[]): Map<string, CustAggregate> => {
  const customerMap = new Map<string, CustAggregate>();

  for (const inv of invoices) {
    const cust = inv.customer;
    if (!cust?._id && !cust?.id) continue;
    const cid = String(cust._id || cust.id);
    const billDate = toDate(inv.billDate) ?? toDate(inv.createdAt);
    if (!billDate) continue;

    const items = (inv.items || []).filter((x: any) => x && typeof x === 'object');
    const lines: RecallHistoryLine[] = [];
    const frameParts: string[] = [];
    const lensParts: string[] = [];
    const fragranceLines: any[] = [];

    for (const item of items) {
      const line = historyLine(item);
      if (line) lines.push(line);
      if (isFrameLine(item)) frameParts.push(line?.name || 'Frame');
      if (isLensLine(item)) lensParts.push(item.lensBrand || item.lensName || 'Lenses');
      if (isFragranceLine(item)) fragranceLines.push(item);
    }

    let entry = customerMap.get(cid);
    if (!entry) {
      const recallContacts: Partial<Record<RecallType, Date>> = {};
      for (const [k, v] of Object.entries(cust.recallContacts || {})) {
        const d = toDate(v);
        if (d) recallContacts[k as RecallType] = d;
      }
      entry = {
        customerId: cid,
        name: cust.name || 'Valued Customer',
        phone: cust.mobileNumber || cust.phone || '',
        lastContactedAt: toDate(cust.lastContactedAt),
        lastContactType: cust.lastContactType || null,
        lastOutcome: cust.lastContactOutcome || null,
        snoozedUntil: toDate(cust.snoozedUntil),
        nextAttemptAt: toDate(cust.nextAttemptAt),
        contactPreference: CONTACT_PREFERENCES.includes(cust.contactPreference) ? cust.contactPreference : 'auto',
        phoneInvalid: !!cust.phoneInvalid,
        noAnswerCount: Number(cust.noAnswerCount) || 0,
        recallContacts,
        lastAnyBillDate: billDate,
        lastFrameBill: null,
        lastLensBill: null,
        lastFragranceBill: null,
        fragranceBillDates: [],
        history: [],
        fragrancesBought: new Map(),
      };
      customerMap.set(cid, entry);
    }

    // Invoices arrive newest first, so the first few seen are the latest bills.
    if (entry.history.length < HISTORY_MAX_INVOICES && lines.length > 0) {
      entry.history.push({
        invoiceId: String(inv._id || inv.id),
        invoiceNumber: inv.invoiceNumber,
        billDate: billDate.toISOString(),
        total: Number(inv.total) || 0,
        items: lines.slice(0, HISTORY_MAX_LINES),
      });
    }

    if (billDate > entry.lastAnyBillDate) entry.lastAnyBillDate = billDate;

    if (frameParts.length > 0 && (!entry.lastFrameBill || billDate > entry.lastFrameBill.date)) {
      entry.lastFrameBill = { date: billDate, summary: [...frameParts, ...lensParts].slice(0, 2).join(' + ') };
    }
    if (lensParts.length > 0 && (!entry.lastLensBill || billDate > entry.lastLensBill.date)) {
      entry.lastLensBill = { date: billDate, summary: [...frameParts, ...lensParts].slice(0, 2).join(' + ') };
    }

    if (fragranceLines.length > 0) {
      entry.fragranceBillDates.push(billDate);
      if (!entry.lastFragranceBill || billDate > entry.lastFragranceBill.date) {
        const first = fragranceLines[0];
        const f = typeof first.fragrance === 'object' ? first.fragrance : null;
        entry.lastFragranceBill = {
          date: billDate,
          summary: fragranceLines
            .slice(0, 2)
            .map((it) => {
              const l = historyLine(it);
              return l ? [l.name, l.detail].filter(Boolean).join(' ') : 'Perfume / Attar';
            })
            .join(', '),
          type: f?.type,
          quantity: fragranceLines.reduce((s, it) => s + (Number(it.quantity) || 1), 0),
        };
      }
      for (const item of fragranceLines) {
        const fid = idOf(item.fragrance);
        if (!fid) continue;
        const f = typeof item.fragrance === 'object' ? item.fragrance : null;
        if (f && isCatchAllFragrance(f)) continue; // "Attar" with no real product: nothing to pitch
        const grade = item.fragranceGrade || undefined;
        const key = `${fid}|${grade ?? ''}`;
        const seen = entry.fragrancesBought.get(key);
        if (seen) {
          seen.timesBought = (seen.timesBought ?? 0) + 1;
        } else {
          entry.fragrancesBought.set(key, {
            fragranceId: fid,
            name: fragranceName(f),
            detail: grade,
            timesBought: 1,
            price: Number(item.price) || undefined,
            lastBoughtAt: billDate.toISOString(),
            type: f?.type,
            gender: f?.gender,
          });
        }
      }
    }
  }

  return customerMap;
};

interface DueRecall {
  type: RecallType;
  anchor: Date;
  days: number;
  reason: string;
  item: string;
}

/** Recalls whose window is open for this customer, ignoring contact history. */
const dueRecalls = (entry: CustAggregate, referenceDate: Date): DueRecall[] => {
  const due: DueRecall[] = [];
  const inWindow = (days: number, [from, to]: readonly [number, number]) => days >= from && days <= to;

  if (entry.lastFrameBill) {
    const { date, summary } = entry.lastFrameBill;
    const days = diffInDays(referenceDate, date);
    const item = summary || 'spectacles';
    if (inWindow(days, WINDOWS.frame_fit_check)) {
      due.push({ type: 'frame_fit_check', anchor: date, days, item, reason: `Frame bought ${days} days ago — check fitting` });
    }
    if (inWindow(days, WINDOWS.frame_maintenance)) {
      due.push({ type: 'frame_maintenance', anchor: date, days, item, reason: `Frame is ${Math.round(days / 30)} months old — free service` });
    }
    if (inWindow(days, WINDOWS.frame_upgrade) && diffInDays(referenceDate, entry.lastAnyBillDate) > SALES_QUIET_DAYS) {
      due.push({ type: 'frame_upgrade', anchor: date, days, item, reason: `Frame is ${Math.round(days / 30)} months old — new designs` });
    }
  }

  if (entry.lastLensBill) {
    const { date, summary } = entry.lastLensBill;
    const days = diffInDays(referenceDate, date);
    if (inWindow(days, WINDOWS.eye_test)) {
      due.push({ type: 'eye_test', anchor: date, days, item: summary || 'glasses', reason: `Last eye check ${Math.round(days / 30)} months ago` });
    }
  }

  if (entry.lastFragranceBill) {
    const { date, summary, type, quantity } = entry.lastFragranceBill;
    const days = diffInDays(referenceDate, date);
    const expected = expectedRefillDays(entry.fragranceBillDates, type, quantity);
    const item = summary || 'fragrance';
    if (days >= expected - REFILL_EARLY_DAYS && days <= expected + REFILL_LATE_DAYS) {
      due.push({ type: 'fragrance_refill', anchor: date, days, item, reason: `Bought ${days} days ago — usually runs out in ~${expected} days` });
    } else if (
      days > expected + REFILL_LATE_DAYS &&
      days <= FRAGRANCE_NEW_MAX_DAYS &&
      diffInDays(referenceDate, entry.lastAnyBillDate) > SALES_QUIET_DAYS
    ) {
      due.push({ type: 'fragrance_new', anchor: date, days, item, reason: `No fragrance bought for ${days} days` });
    }
  }

  return due;
};

/**
 * Builds today's recall tasks from bills (newest first, items and customer populated) and the
 * fragrance catalog. Pure, so it can be tested without Firestore.
 */
export const buildRecallTasks = (invoices: any[], catalog: any[], referenceDate: Date): RecallTasksResponse => {
  const calls: RecallTask[] = [];
  const messages: RecallTask[] = [];
  const done: RecallTask[] = [];

  for (const entry of aggregateCustomers(invoices).values()) {
    if (!entry.phone || entry.phoneInvalid || entry.contactPreference === 'no_contact') continue;
    if (entry.snoozedUntil && entry.snoozedUntil > referenceDate) continue;

    // A recall already handled for the purchase it counts from is finished until they buy again.
    const open = dueRecalls(entry, referenceDate).filter((d) => {
      const contacted = entry.recallContacts[d.type];
      return !contacted || contacted < d.anchor;
    });

    const daysSinceContact = entry.lastContactedAt ? diffInDays(referenceDate, entry.lastContactedAt) : Infinity;
    const recentlyContacted = daysSinceContact <= CONTACT_GAP_DAYS;
    // Unanswered calls are retried (from the next day) instead of waiting out the contact gap.
    const retrying = entry.lastOutcome === 'no_answer' && entry.noAnswerCount > 0;
    const waitingForRetry = !!entry.nextAttemptAt && entry.nextAttemptAt > referenceDate;

    const doneTask = () => {
      const type = (entry.lastContactType as RecallType) || null;
      if (!type || !RECALL_RULES[type]) return;
      const due = dueRecalls(entry, referenceDate).find((d) => d.type === type);
      done.push(
        makeTask(entry, due ?? { type, anchor: entry.lastAnyBillDate, days: diffInDays(referenceDate, entry.lastAnyBillDate), reason: RECALL_RULES[type].label, item: '' }, [], catalog, referenceDate),
      );
    };

    if (open.length === 0 || waitingForRetry || (recentlyContacted && !retrying)) {
      if (recentlyContacted) doneTask();
      continue;
    }

    open.sort((a, b) => KIND_PRIORITY[RECALL_RULES[b.type].kind] - KIND_PRIORITY[RECALL_RULES[a.type].kind] || b.days - a.days);
    const [main, ...rest] = open;
    const task = makeTask(entry, main, rest, catalog, referenceDate);
    (task.channel === 'call' ? calls : messages).push(task);
  }

  sortTasks(calls);
  sortTasks(messages);
  done.sort((a, b) => (b.lastContactedAt ?? '').localeCompare(a.lastContactedAt ?? ''));

  const data = { calls, messages, done };
  return {
    generatedAt: referenceDate.toISOString(),
    storeMapsLink: STORE_MAPS_LINK,
    dailyCallTarget: DAILY_CALL_TARGET,
    ...data,
    counts: countsFor(data),
  };
};

const makeTask = (
  entry: CustAggregate,
  due: DueRecall,
  others: DueRecall[],
  catalog: any[],
  referenceDate: Date,
): RecallTask => {
  const rule = RECALL_RULES[due.type];
  const isFragrance = due.type === 'fragrance_refill' || due.type === 'fragrance_new';
  const bought = isFragrance
    ? [...entry.fragrancesBought.values()].sort(
        (a, b) => (b.timesBought ?? 0) - (a.timesBought ?? 0) || (b.lastBoughtAt ?? '').localeCompare(a.lastBoughtAt ?? ''),
      )
    : [];
  const refillPicks: RecallPitchProduct[] = bought.slice(0, PITCH_MAX).map(({ type: _t, gender: _g, ...p }) => p);
  const newPicks = isFragrance ? pickNewArrivals(catalog, bought, referenceDate) : [];

  const { script, message } = MESSAGES[due.type]({ name: entry.name, days: due.days, item: due.item, refillPicks, newPicks });
  const follow = followUpMessage(entry.name);
  const refillText = refillPicks.length > 0 ? refillMessage(entry.name, refillPicks) : null;
  const newText = newPicks.length > 0 ? newArrivalMessage(entry.name, refillPicks[0], newPicks) : null;

  return {
    customerId: entry.customerId,
    name: entry.name,
    phone: entry.phone,
    recallType: due.type,
    kind: rule.kind,
    channel: channelFor(rule.channel, entry.contactPreference, entry.noAnswerCount),
    label: rule.label,
    reason: due.reason,
    daysElapsed: due.days,
    lastBillDate: due.anchor.toISOString(),
    lastItemSummary: due.item,
    otherReasons: others.map((o) => ({ recallType: o.type, label: RECALL_RULES[o.type].label })),
    callScript: script,
    messageText: message,
    waLink: buildWaLink(entry.phone, message),
    followUp: { messageText: follow, waLink: buildWaLink(entry.phone, follow) },
    contactPreference: entry.contactPreference,
    noAnswerCount: entry.noAnswerCount,
    lastOutcome: entry.lastOutcome,
    lastContactedAt: entry.lastContactedAt ? entry.lastContactedAt.toISOString() : null,
    lastContactType: entry.lastContactType,
    history: entry.history,
    ...(isFragrance
      ? {
          refillPicks,
          newPicks,
          refillPitch: refillText ? { messageText: refillText, waLink: buildWaLink(entry.phone, refillText) } : null,
          newPitch: newText ? { messageText: newText, waLink: buildWaLink(entry.phone, newText) } : null,
        }
      : {}),
  };
};

const computeRecalls = async (referenceDate: Date): Promise<RecallTasksResponse> => {
  const minDate = new Date(referenceDate.getTime() - LOOKBACK_DAYS * DAY_MS);

  const [invoices, catalog]: [any[], any[]] = await Promise.all([
    Invoice.find({ billDate: { $gte: minDate } })
      .select('customer items billDate createdAt invoiceNumber total')
      .populate(
        'customer',
        'name mobileNumber phone lastContactedAt lastContactType lastContactOutcome snoozedUntil nextAttemptAt contactPreference phoneInvalid noAnswerCount recallContacts',
      )
      .populate({
        path: 'items',
        select:
          'frame opticalLens fragrance prescription lensBrand lensName lensType lensCategory frameVariantLabel frameAttrs fragranceGrade itemName type quantity price spherical rightEyeNumber',
        populate: [
          { path: 'frame', select: 'name companyName' },
          { path: 'fragrance', select: 'name companyName type gender' },
        ],
      })
      .sort({ billDate: -1 })
      .lean(),
    // Candidates for the "try something new" pitch on fragrance recalls.
    Fragrance.find({ isArchived: false })
      .select('name companyName type gender channels sellPrice stock variants scent createdAt')
      .lean(),
  ]);

  return buildRecallTasks(invoices, catalog, referenceDate);
};

// ── Recording contacts ───────────────────────────────────────────────────────

/**
 * Records how a recall contact went. "No answer" schedules a retry for the next day (and moves the
 * recall to WhatsApp after two misses); every other outcome closes the recall for the purchase it
 * counts from and starts the 30-day contact gap.
 */
export const logRecallOutcome = async (
  customerId: string,
  recallType: RecallType,
  outcome: RecallOutcome,
  options: { channel?: RecallChannel; note?: string; staff?: string } = {},
) => {
  if (!RECALL_TYPES.includes(recallType)) throw new Error('Unknown recall type');
  if (!RECALL_OUTCOMES.includes(outcome)) throw new Error('Unknown outcome');
  const customer: any = await Customer.findById(customerId);
  if (!customer) throw new Error('Customer not found');

  const now = new Date();
  const channel: RecallChannel = options.channel ?? (outcome === 'whatsapp_sent' ? 'whatsapp' : 'call');
  customer.lastContactedAt = now;
  customer.lastContactType = recallType;
  customer.lastContactOutcome = outcome;

  if (outcome === 'no_answer') {
    customer.noAnswerCount = (Number(customer.noAnswerCount) || 0) + 1;
    customer.nextAttemptAt = new Date(now.getTime() + 20 * 60 * 60 * 1000); // tomorrow's list
  } else {
    customer.noAnswerCount = 0;
    customer.nextAttemptAt = null;
    customer.recallContacts = { ...(customer.recallContacts || {}), [recallType]: now };
  }
  if (outcome === 'wrong_number') customer.phoneInvalid = true;
  if (outcome === 'do_not_contact') customer.contactPreference = 'no_contact';
  if (options.note) customer.notes = customer.notes ? `${customer.notes} | ${options.note}` : options.note;

  await customer.save();
  invalidateRecallCache();
  await patchSnapshot(customerId, { kind: 'outcome', outcome, at: now, recallType, noAnswerCount: customer.noAnswerCount });

  await MarketingEvent.create({
    eventType: channel === 'call' ? 'call_logged' : 'message_sent',
    customerId: customer._id,
    payload: {
      channel: channel === 'call' ? 'phone_call' : 'manual_whatsapp',
      recallType,
      outcome,
      ...(options.staff ? { staff: options.staff } : {}),
      contactedAt: now,
    },
  });

  return { success: true, customerId, outcome, contactedAt: now, noAnswerCount: customer.noAnswerCount };
};

/** Old "mark sent" action: a WhatsApp message went out. */
export const markCustomerRecallSent = async (customerId: string, recallType: RecallType, notes?: string) =>
  logRecallOutcome(customerId, recallType, 'whatsapp_sent', { channel: 'whatsapp', note: notes });

export const setContactPreference = async (customerId: string, preference: ContactPreference) => {
  if (!CONTACT_PREFERENCES.includes(preference)) throw new Error('Unknown contact preference');
  const customer: any = await Customer.findById(customerId);
  if (!customer) throw new Error('Customer not found');
  customer.contactPreference = preference;
  await customer.save();
  invalidateRecallCache();
  await patchSnapshot(customerId, { kind: 'preference', preference });
  return { success: true, customerId, contactPreference: preference };
};

export const snoozeCustomerRecall = async (customerId: string, days = 14) => {
  const customer = await Customer.findById(customerId);
  if (!customer) throw new Error('Customer not found');

  customer.snoozedUntil = new Date(Date.now() + days * 86400000);
  await customer.save();
  invalidateRecallCache();
  await patchSnapshot(customerId, { kind: 'snooze' });

  return { success: true, customerId, snoozedUntil: customer.snoozedUntil };
};
