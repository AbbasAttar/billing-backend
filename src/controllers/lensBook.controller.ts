import { Request, Response, NextFunction } from 'express';
import { LensBookEntry } from '../models/LensBookEntry.model';
import { billLineToBookRow, cleanLensBookRow, hasPower, type BookListRow, type LensBookInput } from '../services/lensBook';
import { Invoice } from '../models/Invoice.model';
import { lensTypeOf } from '../services/opticsInsights';
import { Customer } from '../models/Customer.model';
import { Prescription } from '../models/Prescription.model';
import { buildLongTerm } from '../services/lensLongTerm';
import { isLensLine, normalizeLensLine, type LensLine } from '../services/lensSales';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { created, fail, ok } from '../utils/response';

const MAX_BATCH = 200;

/**
 * GET /lens-book?year=2024&source=book|bills|all — lens sales dated in that year (default: all years),
 * newest first. "book" (default) = typed-in book lines; "bills" = lens lines from bills, read-only,
 * in the same shape (source: 'bill'); "all" = both.
 */
export const listLensBook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(String(req.query.year ?? ''), 10);
    const source = req.query.source === 'bills' || req.query.source === 'all' ? req.query.source : 'book';
    const range = year >= 1950 && year <= 2100 ? { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) } : null;
    const inRange = (d: Date) => !range || (d >= range.from && d < range.to);

    const out: BookListRow[] = [];
    if (source !== 'bills') {
      const filter = range ? { date: { $gte: range.from, $lt: range.to } } : {};
      const book = (await LensBookEntry.find(filter).lean()) as any[];
      for (const e of book) out.push({ ...e, _id: String(e._id ?? e.id), source: 'book' });
    }
    if (source !== 'book') {
      // All three collections are mirrored: one read each.
      const [items, invoices, customers] = await Promise.all([
        InvoiceItem.find({}).lean(), Invoice.find({}).lean(), Customer.find({}).lean(),
      ]) as any[][];
      const invById = new Map(invoices.map((i) => [String(i._id ?? i.id), i]));
      const custById = new Map(customers.map((c) => [String(c._id ?? c.id), c]));
      for (const it of items) {
        if (!isLensLine(it)) continue;
        const inv = it.invoice ? invById.get(String(it.invoice?._id ?? it.invoice)) : undefined;
        const cust = inv?.customer ? custById.get(String(inv.customer?._id ?? inv.customer)) : undefined;
        const row = billLineToBookRow(normalizeLensLine(it), inv, cust, lensTypeOf);
        if (inRange(row.date)) out.push(row);
      }
    }
    out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return ok(res, out);
  } catch (e) { next(e); }
};

/** POST /lens-book — one row, or { rows: [...] } (up to 200). All rows must be valid or nothing is saved. */
export const addLensBook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw: unknown[] = Array.isArray(req.body?.rows) ? req.body.rows : [req.body];
    if (raw.length === 0) return fail(res, 'Nothing to save');
    if (raw.length > MAX_BATCH) return fail(res, `Too many rows at once (max ${MAX_BATCH})`);
    const rows: (LensBookInput & { customerId?: string | null; prescriptionId?: string | null })[] = [];
    for (let i = 0; i < raw.length; i++) {
      const r = cleanLensBookRow((raw[i] ?? {}) as Record<string, unknown>);
      if ('error' in r) return fail(res, raw.length > 1 ? `Row ${i + 1}: ${r.error}` : r.error);
      rows.push(r.row);
    }
    // One line from the entry page may also save the customer and their prescription.
    const one = raw.length === 1 ? (raw[0] as Record<string, unknown>) : null;
    if (one?.saveCustomer === true && rows[0].customer) {
      const picked = typeof one.customerId === 'string' && one.customerId ? one.customerId : null;
      const link = await linkCustomer(rows[0], picked);
      if ('error' in link) return fail(res, link.error, 404);
      Object.assign(rows[0], link);
    }
    const saved = await LensBookEntry.insertMany(rows);
    return created(res, saved);
  } catch (e) { next(e); }
};

/**
 * Finds the customer by mobile (last 10 digits) or makes one, then saves the line's powers as a
 * prescription. Customers only get recalls from invoices, so book customers are never contacted
 * because of this. Without a mobile a new customer is made (it shows in Data Cleanup → missing phones).
 */
async function linkCustomer(row: LensBookInput, pickedId: string | null): Promise<{ customerId: string; prescriptionId: string | null } | { error: string }> {
  let customer: any = null;
  // Picked from the customer search: use that customer as is.
  if (pickedId) {
    customer = await Customer.findById(pickedId);
    if (!customer) return { error: 'Picked customer not found' };
  } else if (row.phone) {
    const all = (await Customer.find({}).lean()) as any[]; // mirrored: one read
    customer = all.find((c) => String(c.mobileNumber ?? '').replace(/\D/g, '').slice(-10) === row.phone) ?? null;
  }
  if (!customer) {
    customer = await new Customer({
      name: row.customer as string,
      mobileNumber: row.phone ?? '',
      tags: ['lens-book'],
      notes: 'Added from the old lens book',
    }).save();
  }
  const customerId = String(customer._id ?? customer.id);

  let prescriptionId: string | null = null;
  if (hasPower(row)) {
    const p = (v: number | null | undefined) => (v === null || v === undefined ? undefined : v);
    const rx = await new Prescription({
      customer: customerId,
      label: `Lens book ${row.date.toISOString().slice(0, 10)}`,
      userName: row.customer ?? undefined,
      rightSpherical: p(row.rSph), rightCylinder: p(row.rCyl), rightAxis: p(row.rAxis), rightAddition: p(row.rAdd),
      leftSpherical: p(row.lSph), leftCylinder: p(row.lCyl), leftAxis: p(row.lAxis), leftAddition: p(row.lAdd),
      notes: 'From the old lens book',
    }).save();
    prescriptionId = String((rx as any)._id ?? (rx as any).id);
  }
  return { customerId, prescriptionId };
}

/** PUT /lens-book/:id — replace one row. */
export const updateLensBook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = cleanLensBookRow((req.body ?? {}) as Record<string, unknown>);
    if ('error' in r) return fail(res, r.error);
    const updated = await LensBookEntry.findByIdAndUpdate(String(req.params.id), { $set: r.row }, { new: true });
    if (!updated) return fail(res, 'Entry not found', 404);
    return ok(res, updated);
  } catch (e) { next(e); }
};

/** DELETE /lens-book/:id */
export const deleteLensBook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const removed = await LensBookEntry.findByIdAndDelete(String(req.params.id));
    if (!removed) return fail(res, 'Entry not found', 404);
    return ok(res, { _id: String(req.params.id) });
  } catch (e) { next(e); }
};

/**
 * GET /lens-book/summary — all years, bills plus the lens book: pairs and sales per year, and per lens
 * type with margin from every line that has a cost. Lens analytics → Rx demand → All years.
 */
export const lensLongTerm = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [bills, book] = await Promise.all([
      InvoiceItem.find({}).lean(), // mirrored collection: read from the mirror, not doc by doc
      LensBookEntry.find({}).lean(),
    ]);
    return ok(res, buildLongTerm(bills as LensLine[], book as any[]));
  } catch (e) { next(e); }
};
