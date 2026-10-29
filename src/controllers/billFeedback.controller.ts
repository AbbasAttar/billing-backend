import { Request, Response, NextFunction } from 'express';
import { Invoice } from '../models/Invoice.model';
import { BillFeedback } from '../models/BillFeedback.model';
import { generateReviewDraft, templateReviewDraft } from '../services/reviewDraft';

/** Firestore auto ids and legacy ObjectIds; anything else is not an invoice. */
const isInvoiceId = (id: string) => /^[A-Za-z0-9_-]{6,64}$/.test(id);

const notFound = (res: Response) => res.status(404).json({ success: false, message: 'Invoice not found' });

const sumPaid = (payments: any[] = []) =>
  payments.reduce((s: number, p: any) => s + (Number(p.amount) || 0) + (Number(p.writeoff) || 0), 0);

/** "AOH" + "AOH Chandan" → "AOH Chandan": the brand only when the name doesn't already start with it. */
const withBrand = (brand?: string, name?: string) =>
  brand && name && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name || brand || '';

const itemName = (it: any): string =>
  it.itemName ||
  it.frame?.web?.displayName || withBrand(it.frame?.companyName, it.frame?.name) ||
  it.fragrance?.web?.displayName || withBrand(it.fragrance?.companyName, it.fragrance?.name) ||
  it.opticalLens?.web?.displayName || it.opticalLens?.name ||
  [it.lensBrand, it.lensName].filter(Boolean).join(' ').replace(/\blocal\b/gi, '').trim() ||
  it.lensLabel || 'Item';

const itemType = (it: any) =>
  it.frame ? 'frame' : it.fragrance ? 'fragrance' : it.opticalLens || it.lensName || it.lensBrand ? 'lens' : 'other';

/** Fields every feedback document starts with, copied from its invoice. */
const seedFields = (invoice: any) => ({
  invoice: String(invoice._id),
  invoiceNumber: invoice.invoiceNumber ?? String(invoice._id).slice(-6),
  customer: typeof invoice.customer === 'object' ? String(invoice.customer?._id ?? '') : String(invoice.customer ?? ''),
  customerName: typeof invoice.customer === 'object' ? invoice.customer?.name ?? '' : '',
  billDate: invoice.billDate ?? invoice.createdAt,
});

// ── GET /api/public/bill/:id ─────────────────────────────────────────────────
// Online bill linked from the WhatsApp invoice. Anyone with the link can read it, like /pay/:id,
// so it carries no phone, address or prescription: first name, items, totals and feedback state.
export const getPublicBill = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id ?? '');
    if (!isInvoiceId(id)) return notFound(res);

    const [invoice, feedback] = await Promise.all([
      Invoice.findById(id)
        .populate({
          path: 'items',
          populate: [
            { path: 'frame', select: 'web.displayName name companyName' },
            { path: 'opticalLens', select: 'web.displayName name' },
            { path: 'fragrance', select: 'web.displayName name companyName' },
          ],
        })
        .populate('customer', 'name')
        .lean() as any,
      BillFeedback.findById(id).lean() as any,
    ]);
    if (!invoice) return notFound(res);

    const paid = sumPaid(invoice.payments);
    const total = invoice.total ?? 0;
    const name: string = invoice.customer?.name ?? '';

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        invoiceNumber: invoice.invoiceNumber ?? String(invoice._id).slice(-6),
        billDate: invoice.billDate ?? invoice.createdAt ?? null,
        firstName: name.trim().split(/\s+/)[0] ?? '',
        items: (invoice.items ?? []).map((it: any) => ({
          name: itemName(it),
          type: itemType(it),
          quantity: it.quantity ?? 1,
          price: it.price ?? 0,
          details: it.lensName
            ? [it.lensIndex, it.lensCoating].filter(Boolean).join(' · ') || null
            : it.fragranceGrade || it.frameVariantLabel || null,
        })),
        subtotal: invoice.subtotal ?? total,
        discount: invoice.discount ?? 0,
        returnCredit: invoice.returnCredit ?? 0,
        total,
        paid: Math.round(paid * 100) / 100,
        balance: Math.max(0, Math.round((total - paid) * 100) / 100),
        feedback: {
          rating: feedback?.rating ?? null,
          commented: Boolean(feedback?.comment),
          googleClicked: Boolean(feedback?.googleClickedAt),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const BILL_EVENTS = ['open', 'prompt', 'dismiss', 'google'] as const;
type BillEvent = (typeof BILL_EVENTS)[number];

// ── POST /api/public/bill/:id/event  { type } ────────────────────────────────
// Funnel beacons from the bill page. Sent by the browser, so link previews don't count as opens.
export const recordBillEvent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id ?? '');
    const type = req.body?.type as BillEvent;
    if (!isInvoiceId(id)) return notFound(res);
    if (!BILL_EVENTS.includes(type)) {
      res.status(400).json({ success: false, message: 'Unknown event' });
      return;
    }

    const [invoice, existing] = await Promise.all([
      Invoice.findById(id).populate('customer', 'name').lean() as any,
      BillFeedback.findById(id).lean() as any,
    ]);
    if (!invoice) return notFound(res);

    const now = new Date();
    const set: Record<string, unknown> = {};
    const inc: Record<string, number> = {};
    if (type === 'open') {
      inc.openCount = 1;
      set.lastOpenedAt = now;
      if (!existing?.firstOpenedAt) set.firstOpenedAt = now;
    }
    // Only the first time counts for the funnel.
    if (type === 'prompt' && !existing?.promptShownAt) set.promptShownAt = now;
    if (type === 'dismiss' && !existing?.dismissedAt) set.dismissedAt = now;
    if (type === 'google' && !existing?.googleClickedAt) set.googleClickedAt = now;

    if (Object.keys(set).length || Object.keys(inc).length) {
      await BillFeedback.findByIdAndUpdate(
        id,
        { $set: set, ...(Object.keys(inc).length ? { $inc: inc } : {}), $setOnInsert: seedFields(invoice) },
        { upsert: true, new: true },
      );
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/public/bill/:id/feedback  { rating, comment? } ─────────────────
export const submitBillFeedback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id ?? '');
    if (!isInvoiceId(id)) return notFound(res);

    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ success: false, message: 'Rating must be 1 to 5' });
      return;
    }
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : '';

    const invoice = await Invoice.findById(id).populate('customer', 'name').lean() as any;
    if (!invoice) return notFound(res);

    await BillFeedback.findByIdAndUpdate(
      id,
      {
        $set: { rating, ratedAt: new Date(), ...(comment ? { comment } : {}) },
        $setOnInsert: seedFields(invoice),
      },
      { upsert: true, new: true },
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

/** AI drafts per bill; after this the page gets template drafts, so one link can't run up the bill. */
const MAX_AI_DRAFTS = 6;

const cleanList = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : [])
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, max);

// ── POST /api/public/bill/:id/review-draft  { rating, items[], aspects[] } ───
// Google-review text for any star rating, from what the customer picked. They edit it and post
// it themselves on Google; nothing is posted for them.
export const createReviewDraft = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id ?? '');
    if (!isInvoiceId(id)) return notFound(res);

    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ success: false, message: 'Rating must be 1 to 5' });
      return;
    }
    const items = cleanList(req.body?.items, 6);
    const aspects = cleanList(req.body?.aspects, 6);

    const [invoice, existing] = await Promise.all([
      Invoice.findById(id).populate('customer', 'name').lean() as any,
      BillFeedback.findById(id).lean() as any,
    ]);
    if (!invoice) return notFound(res);

    const earlier: string[] = existing?.reviewDrafts ?? [];
    const input = { rating, items, aspects, avoid: earlier.slice(-3) };
    const { text } = earlier.length >= MAX_AI_DRAFTS
      ? { text: templateReviewDraft(input, earlier.length) }
      : await generateReviewDraft(input);

    await BillFeedback.findByIdAndUpdate(
      id,
      { $set: { reviewDrafts: [...earlier, text].slice(-MAX_AI_DRAFTS - 4) }, $setOnInsert: seedFields(invoice) },
      { upsert: true, new: true },
    );
    res.json({ success: true, data: { text } });
  } catch (error) {
    next(error);
  }
};

// ── POST /api/invoices/:id/whatsapp-sent ─────────────────────────────────────
// The counter opened WhatsApp with this bill's message: the funnel's "sent" step.
export const recordBillSent = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id ?? '');
    if (!isInvoiceId(id)) return notFound(res);
    const [invoice, existing] = await Promise.all([
      Invoice.findById(id).populate('customer', 'name').lean() as any,
      BillFeedback.findById(id).lean() as any,
    ]);
    if (!invoice) return notFound(res);

    const now = new Date();
    await BillFeedback.findByIdAndUpdate(
      id,
      {
        $set: { lastSentAt: now, ...(existing?.firstSentAt ? {} : { firstSentAt: now }) },
        $inc: { sentCount: 1 },
        $setOnInsert: seedFields(invoice),
      },
      { upsert: true, new: true },
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/bill-feedback?days=30 ───────────────────────────────────────────
// Review funnel for bills dated in the window, plus every rating and comment.
export const getBillFeedbackSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(Math.max(parseInt(String(req.query.days ?? '30'), 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 86_400_000);

    // A bill counts when it was dated, sent or opened in the window, so resending an old bill counts too.
    // The collection is mirrored and small (one document per bill that was sent or opened).
    const [bills, docs] = await Promise.all([
      Invoice.countDocuments({ billDate: { $gte: since } }),
      BillFeedback.find({}).lean() as any,
    ]);
    const inWindow = (v: unknown) => v != null && new Date(v as any).getTime() >= since.getTime();
    const rows = (docs as any[]).filter((d) => inWindow(d.billDate) || inWindow(d.firstSentAt) || inWindow(d.firstOpenedAt));
    const rated = rows.filter((d) => d.rating);
    const funnel = {
      bills,
      sent: rows.filter((d) => d.firstSentAt).length,
      opened: rows.filter((d) => d.firstOpenedAt).length,
      promptShown: rows.filter((d) => d.promptShownAt).length,
      rated: rated.length,
      positive: rated.filter((d) => d.rating >= 4).length,
      negative: rated.filter((d) => d.rating <= 3).length,
      googleClicked: rows.filter((d) => d.googleClickedAt).length,
      dismissed: rows.filter((d) => d.dismissedAt && !d.rating).length,
      avgRating: rated.length ? Math.round((rated.reduce((s, d) => s + d.rating, 0) / rated.length) * 10) / 10 : null,
    };

    const feedback = rated
      .sort((a, b) => new Date(b.ratedAt).getTime() - new Date(a.ratedAt).getTime())
      .map((d) => ({
        _id: String(d._id),
        invoiceNumber: d.invoiceNumber,
        customer: d.customer,
        customerName: d.customerName,
        billDate: d.billDate,
        rating: d.rating,
        comment: d.comment ?? '',
        ratedAt: d.ratedAt,
        googleClicked: Boolean(d.googleClickedAt),
        resolvedAt: d.resolvedAt ?? null,
      }));

    // Per IST day, by when each step happened.
    const dayKey = (v: unknown) => new Date(new Date(v as any).getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const byDay = new Map<string, { date: string; sent: number; opened: number; rated: number; google: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const date = dayKey(Date.now() - i * 86_400_000);
      byDay.set(date, { date, sent: 0, opened: 0, rated: 0, google: 0 });
    }
    const bump = (v: unknown, key: 'sent' | 'opened' | 'rated' | 'google') => {
      if (!inWindow(v)) return;
      const day = byDay.get(dayKey(v));
      if (day) day[key]++;
    };
    for (const d of rows) {
      bump(d.firstSentAt, 'sent');
      bump(d.firstOpenedAt, 'opened');
      bump(d.ratedAt, 'rated');
      bump(d.googleClickedAt, 'google');
    }
    const daily = [...byDay.values()].reverse();

    res.json({ days, funnel, daily, feedback });
  } catch (error) {
    next(error);
  }
};

// ── PATCH /api/bill-feedback/:id/resolve  { resolved } ───────────────────────
export const resolveBillFeedback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const resolved = req.body?.resolved !== false;
    const doc = await BillFeedback.findByIdAndUpdate(
      String(req.params.id),
      resolved ? { $set: { resolvedAt: new Date() } } : { $unset: { resolvedAt: 1 } },
      { new: true },
    );
    if (!doc) {
      res.status(404).json({ message: 'Feedback not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
