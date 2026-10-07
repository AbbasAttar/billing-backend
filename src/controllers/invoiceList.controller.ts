import { Request, Response, NextFunction } from 'express';
import { FieldPath } from 'firebase-admin/firestore';
import { Invoice } from '../models/Invoice.model';
import { Order } from '../models/Order.model';
import { getDb, snapToData } from '../lib/firestoreDb';
import { populateDocs } from '../lib/firestoreModel';
import { flagExpensiveOp, recordReads } from '../lib/readMeter';
import { generateInvoiceNumber } from '../utils/invoiceNumber';

/**
 * Bounded invoice listing for the admin app.
 *
 * `GET /invoices/merged` used to download every invoice (plus every item, product and customer)
 * on each call. These handlers only read what the screen needs:
 *
 *   /merged?from&to              invoices billed in the window (+ online orders created in it)
 *   /merged?activity=1&from&to   window above + invoices cleared in the window
 *   /merged?due=1                invoices with an outstanding balance
 *   /merged?recent=20            the latest N invoices
 *   (flags combine as a union)
 *   /merged/page?limit&cursor    cursor-paginated history (newest first)
 *   /search?q&customerIds        invoice-number lookup + latest bills of given customers
 */

const COL = 'invoices';
const PAID_STATUSES = ['paid', 'preparing', 'ready', 'dispatched', 'fulfilled'] as const;
/** Online orders that are paid only by token deposit, so a balance is still due. */
const TOKEN_PAID_STATUSES = ['preparing', 'ready', 'dispatched'] as const;

const MAX_RANGE_DOCS = 1000;
const MAX_DUE_DOCS = 1000;
const MAX_RECENT_DOCS = 100;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

const LIST_POPULATE = [
  { path: 'customer', select: 'name mobileNumber mobile address' },
  {
    path: 'items',
    populate: [
      { path: 'frame', select: 'name companyName houseName' },
      { path: 'opticalLens', select: 'name brand category' },
      { path: 'fragrance', select: 'name companyName type' },
    ],
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseFlag(value: unknown): boolean {
  return value === '1' || value === 'true';
}

function toMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const d = new Date(value as string);
  return d.getTime() || 0;
}

async function runInvoiceQuery(
  build: (q: FirebaseFirestore.Query) => FirebaseFirestore.Query,
): Promise<any[]> {
  const snap = await build(getDb().collection(COL)).get();
  recordReads(COL, Math.max(snap.size, 1));
  return snap.docs.map((d) => snapToData(d)!);
}

let dueFlagsReady = false;

/** True once backfillInvoiceDueFlags has written its marker (cached after the first success). */
async function hasDueFlagsBackfilled(): Promise<boolean> {
  if (dueFlagsReady) return true;
  const snap = await getDb().collection('meta').doc('invoiceDueBackfill').get();
  recordReads('meta', 1);
  dueFlagsReady = snap.exists && snap.data()?.done === true;
  return dueFlagsReady;
}

async function fetchDueInvoices(): Promise<any[]> {
  if (await hasDueFlagsBackfilled()) {
    return runInvoiceQuery((q) => q.where('hasDue', '==', true).limit(MAX_DUE_DOCS));
  }
  // Legacy path until `backfillInvoiceDueFlags --apply` has been run: scans every invoice.
  flagExpensiveOp(
    'invoices:due-legacy-scan',
    'hasDue flags are not backfilled; scanning all invoices. Run src/scripts/backfillInvoiceDueFlags.ts --apply.',
    false,
  );
  const all: any[] = await Invoice.find().lean();
  return all.filter((inv) => {
    const paid = (inv.payments ?? []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
    return (inv.total ?? 0) - paid > 0.01;
  });
}

function dedupeById(docs: any[]): any[] {
  const seen = new Map<string, any>();
  for (const d of docs) {
    const id = String(d.id || d._id);
    if (!seen.has(id)) seen.set(id, d);
  }
  return [...seen.values()];
}

function toInStoreRow(inv: any) {
  return {
    _id: inv._id,
    source: 'in-store' as const,
    invoiceNumber: inv.invoiceNumber,
    customer: inv.customer,
    items: inv.items ?? [],
    total: inv.total,
    subtotal: inv.subtotal,
    discount: inv.discount,
    payments: inv.payments ?? [],
    billDate: inv.billDate,
    billClearDate: inv.billClearDate,
    createdAt: inv.createdAt ?? inv.billDate,
  };
}

function toOnlineRow(ord: any) {
  const paid =
    ord.status === 'paid' || ord.status === 'fulfilled' ? ord.total : (ord.tokenAmount ?? 0);
  return {
    _id: ord._id,
    source: 'online' as const,
    invoiceNumber: ord.invoiceNumber,
    customer: {
      name: ord.customerName,
      mobile: ord.customerPhone,
      mobileNumber: ord.customerPhone,
      address: ord.address,
    },
    items: ord.items ?? [],
    total: ord.total,
    subtotal: ord.subtotal,
    discount: 0,
    payments: [{ amount: paid, method: 'online' as const, date: new Date(ord.updatedAt).toISOString() }],
    billDate: new Date(ord.createdAt).toISOString(),
    createdAt: ord.createdAt,
    orderStatus: ord.status,
  };
}

/** Online orders, optionally bounded to a createdAt window or to those with a balance still due. */
async function fetchOrders(opts: { from?: Date; to?: Date; dueOnly?: boolean }): Promise<any[]> {
  const filter: Record<string, any> = {};
  if (opts.dueOnly) {
    filter.status = { $in: [...TOKEN_PAID_STATUSES] };
  } else {
    filter.status = { $in: [...PAID_STATUSES] };
    const range: Record<string, Date> = {};
    if (opts.from) range.$gte = opts.from;
    if (opts.to) range.$lte = opts.to;
    if (Object.keys(range).length) filter.createdAt = range;
  }

  // createdAt desc matches the existing (status, createdAt DESC) composite index.
  let orders: any[] = await Order.find(filter).sort({ createdAt: -1 }).lean();
  if (opts.dueOnly) orders = orders.filter((o) => (o.tokenAmount ?? 0) < (o.total ?? 0));

  // Auto-assign INV numbers to paid orders that don't have one yet (oldest first)
  const missing = orders.filter((o) => !o.invoiceNumber).sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
  for (const ord of missing) {
    const invNo = await generateInvoiceNumber(new Date(ord.createdAt));
    await Order.updateOne({ _id: ord._id, invoiceNumber: null }, { invoiceNumber: invNo });
    ord.invoiceNumber = invNo;
  }
  return orders;
}

function sortNewestFirst<T extends { billDate?: unknown }>(rows: T[]): T[] {
  return rows.sort((a, b) => toMillis(b.billDate) - toMillis(a.billDate));
}

// ── GET /invoices/merged ─────────────────────────────────────────────────────

export const getMergedInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const activity = parseFlag(req.query.activity);
    const due = parseFlag(req.query.due);
    const recent = Math.min(MAX_RECENT_DOCS, Math.max(0, parseInt(String(req.query.recent ?? '0'), 10) || 0));
    const hasWindow = Boolean(from && to);

    if (!hasWindow && !due && !recent) {
      res.status(400).json({
        message: 'Provide from & to (ISO dates), due=1, or recent=N. Use /invoices/merged/page for full history.',
      });
      return;
    }

    const jobs: Promise<any[]>[] = [];

    if (hasWindow) {
      jobs.push(
        runInvoiceQuery((q) =>
          q.where('billDate', '>=', from!).where('billDate', '<=', to!).orderBy('billDate', 'desc').limit(MAX_RANGE_DOCS),
        ),
      );
      if (activity) {
        // Bills fully settled inside the window, even if they were created earlier.
        jobs.push(
          runInvoiceQuery((q) =>
            q.where('billClearDate', '>=', from!).where('billClearDate', '<=', to!).limit(MAX_RANGE_DOCS),
          ),
        );
      }
    }
    if (due) jobs.push(fetchDueInvoices());
    if (recent) jobs.push(runInvoiceQuery((q) => q.orderBy('billDate', 'desc').limit(recent)));

    const invoiceDocs = dedupeById((await Promise.all(jobs)).flat());
    await populateDocs(invoiceDocs, LIST_POPULATE);

    const orderRows: any[] = [];
    if (hasWindow) orderRows.push(...(await fetchOrders({ from: from!, to: to! })));
    if (due) orderRows.push(...(await fetchOrders({ dueOnly: true })));
    const orders = dedupeById(orderRows);

    res.json(sortNewestFirst([...invoiceDocs.map(toInStoreRow), ...orders.map(toOnlineRow)]));
  } catch (error) {
    next(error);
  }
};

// ── GET /invoices/merged/page ────────────────────────────────────────────────

export const getMergedInvoicesPage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(MAX_PAGE, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_PAGE), 10) || DEFAULT_PAGE));
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';

    let cursorMs: number | null = null;
    let cursorId = '';
    if (cursor) {
      const sep = cursor.indexOf('_');
      cursorMs = Number(cursor.slice(0, sep));
      cursorId = cursor.slice(sep + 1);
      if (sep < 1 || !Number.isFinite(cursorMs) || !cursorId) {
        res.status(400).json({ message: 'Invalid cursor' });
        return;
      }
    }

    const docs = await runInvoiceQuery((q) => {
      let query = q.orderBy('billDate', 'desc').orderBy(FieldPath.documentId(), 'desc');
      if (cursorMs !== null) query = query.startAfter(new Date(cursorMs), cursorId);
      return query.limit(limit + 1);
    });

    const hasMore = docs.length > limit;
    const pageDocs = docs.slice(0, limit);
    await populateDocs(pageDocs, LIST_POPULATE);

    // Online orders interleave by date: take those inside this page's time window.
    const upper = cursorMs !== null ? new Date(cursorMs) : new Date(Date.now() + 86_400_000);
    const lower = hasMore && pageDocs.length ? new Date(toMillis(pageDocs[pageDocs.length - 1].billDate)) : new Date(0);
    const orders = await fetchOrders({ from: lower, to: upper });

    const last = pageDocs[pageDocs.length - 1];
    res.json({
      items: sortNewestFirst([...pageDocs.map(toInStoreRow), ...orders.map(toOnlineRow)]),
      hasMore,
      nextCursor: hasMore && last ? `${toMillis(last.billDate)}_${last.id || last._id}` : null,
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /invoices/search ─────────────────────────────────────────────────────

const SEARCH_SELECT = [{ path: 'customer', select: 'name mobileNumber mobile' }];

export const searchInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const customerIds = String(req.query.customerIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);

    const jobs: Promise<any[]>[] = [];

    if (q.length >= 2) {
      // Digits only ("123") means the sequence part of INV0123/26-27; otherwise treat q as a number prefix.
      const prefix = /^\d+$/.test(q) ? `INV${q.padStart(4, '0')}` : q.toUpperCase();
      jobs.push(
        runInvoiceQuery((query) =>
          query.where('invoiceNumber', '>=', prefix).where('invoiceNumber', '<=', `${prefix}`).limit(5),
        ),
      );
    }
    // Latest two bills of each matched customer (uses the existing customer + billDate DESC index).
    for (const id of customerIds) {
      jobs.push(runInvoiceQuery((query) => query.where('customer', '==', id).orderBy('billDate', 'desc').limit(2)));
    }

    const docs = dedupeById((await Promise.all(jobs)).flat());
    await populateDocs(docs, SEARCH_SELECT);

    res.json(
      sortNewestFirst(
        docs.map((inv) => ({
          _id: inv._id,
          invoiceNumber: inv.invoiceNumber,
          customer: inv.customer,
          total: inv.total,
          payments: inv.payments ?? [],
          billDate: inv.billDate,
        })),
      ),
    );
  } catch (error) {
    next(error);
  }
};
