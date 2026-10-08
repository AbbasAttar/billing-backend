import { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import { Coating } from '../models/Coating.model';
import { Invoice, IPayment } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { Prescription } from '../models/Prescription.model';
import { Customer } from '../models/Customer.model';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { SiteSetting } from '../models/SiteSetting.model';
import { financialYear, formatInvoiceNo } from '../utils/invoiceNumber';
import { InvoiceCounter } from '../models/InvoiceCounter.model';
import { LensStock } from '../models/LensStock.model';
import { ModelTx, runModelTransaction } from '../lib/firestoreModel';
import { PurchaseEntry } from '../models/PurchaseEntry.model';
import { createPendingPurchasesForInvoice, invalidateInvoiceLookupCache } from './purchaseEntry.controller';
import type { CreateInvoiceInput, CreateInvoiceItemInput, DemandLogInput } from '../types';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isValidId(id: any): boolean {
  if (!id) return false;
  if (typeof id === 'string') return id.trim().length > 0 && id.trim() !== 'undefined' && id.trim() !== 'null';
  if (typeof id === 'object' && (id._id || id.id)) return true;
  return false;
}

// ── Populate helper ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const populateInvoice = (query: any) =>
  query
    .populate('customer')
    .populate({
      path: 'items',
      populate: [
        { path: 'frame' },
        { path: 'opticalLens' },
        { path: 'prescription' },
        { path: 'fragrance' },
      ],
    });

// ── Validation ───────────────────────────────────────────────────────────────

const validateAxis = (val?: number): boolean =>
  val === undefined || (val >= 0 && val <= 180);

function validateItems(items: CreateInvoiceItemInput[]): string | null {
  for (const [i, item] of items.entries()) {
    if (typeof item.quantity !== 'number' || item.quantity <= 0) {
      return `Item ${i + 1}: quantity must be a positive number.`;
    }
    if (typeof item.price !== 'number' || item.price < 0) {
      return `Item ${i + 1}: price must be a non-negative number.`;
    }
    if (item.type === 'opticalLens') {
      const hasLegacyEyeValues =
        item.spherical !== undefined && item.spherical !== null ||
        item.cylinder !== undefined && item.cylinder !== null ||
        item.axis !== undefined && item.axis !== null ||
        item.addition !== undefined && item.addition !== null;
      const hasSimplifiedPrescription =
        Boolean(item.prescription) ||
        Boolean(item.rightEyeNumber?.trim()) ||
        Boolean(item.leftEyeNumber?.trim()) ||
        Boolean(item.lensLabel?.trim()) ||
        Boolean(item.isSameNumber);

      if (hasLegacyEyeValues && item.eye !== 'left' && item.eye !== 'right') {
        return `Item ${i + 1}: optical lens item must declare eye as 'left' or 'right'.`;
      }
      if (!hasLegacyEyeValues && !hasSimplifiedPrescription && item.eye !== undefined && item.eye !== 'left' && item.eye !== 'right' && item.eye !== 'both') {
        return `Item ${i + 1}: optical lens item has an invalid eye value.`;
      }
      if (!validateAxis(item.axis ?? undefined)) {
        return `Item ${i + 1}: axis must be between 0 and 180.`;
      }
    }
  }
  return null;
}

// ── GET all invoices ─────────────────────────────────────────────────────────

export const getAllInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Bounded: this used to return every invoice. Use /invoices/merged/page for full history.
    const invoices = await populateInvoice(Invoice.find().sort({ billDate: -1 }).limit(100));
    res.json(invoices);
  } catch (error) {
    next(error);
  }
};

// ── GET by id ────────────────────────────────────────────────────────────────

export const getInvoiceById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = await populateInvoice(Invoice.findById(req.params.id));
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }
    res.json(invoice);
  } catch (error) {
    next(error);
  }
};

// ── GET by customer ──────────────────────────────────────────────────────────

export const getInvoicesByCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoices = await populateInvoice(
      Invoice.find({ customer: req.params.customerId }).sort({ billDate: -1, _id: -1 })
    );
    res.json(invoices);
  } catch (error) {
    next(error);
  }
};

// ── Transaction helpers ──────────────────────────────────────────────────────

/** A validation failure detected inside a transaction; aborts it and becomes an HTTP response. */
class InvoiceHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sendHttpError(error: unknown, res: Response): boolean {
  if (error instanceof InvoiceHttpError) {
    res.status(error.status).json({ message: error.message });
    return true;
  }
  return false;
}

const idOf = (v: any): string => (v && typeof v === 'object' ? String(v._id ?? v.id) : String(v));

const sumSettled = (payments: IPayment[]) => payments.reduce((sum, p) => sum + p.amount + (p.writeoff ?? 0), 0);

/** Same label rule as the admin UI uses to name a frame colour variant. */
const frameVariantName = (v: any) => v.label || (v.colors ?? []).map((c: any) => c.name).join(' + ');

interface CatalogLensFilter {
  brand: string;
  name: string;
  category: any;
  index: any;
  coating: any;
  spherical: any;
  cylinder: any;
  addition: any;
}

/** Existing catalog lens matching brand/name (case-insensitive) and the exact spec, if any. */
async function findCatalogLens(filter: CatalogLensFilter) {
  return OpticalLens.findOne({
    brand: { $regex: new RegExp(`^${escapeRegExp(filter.brand)}$`, 'i') },
    name: { $regex: new RegExp(`^${escapeRegExp(filter.name)}$`, 'i') },
    category: filter.category,
    index: filter.index,
    coating: filter.coating,
    spherical: filter.spherical,
    cylinder: filter.cylinder,
    addition: filter.addition,
  } as any);
}

/**
 * Loads an invoice and its items inside a transaction, lets `mutate` change them, then writes the
 * invoice back with recalculated totals. Everything commits together or not at all.
 */
async function mutateInvoice(
  invoiceId: string,
  mutate: (invoice: any, items: Map<string, any>, t: ModelTx) => Promise<void> | void,
  opts: { loadItems?: boolean } = {},
): Promise<void> {
  await runModelTransaction(async (t) => {
    const invoice = await t.get<any>(Invoice, invoiceId);
    if (!invoice) throw new InvoiceHttpError(404, 'Invoice not found');
    invoice.payments = invoice.payments ?? [];
    invoice.items = (invoice.items ?? []).map(idOf);
    const items = opts.loadItems ? await t.getMany<any>(InvoiceItem, invoice.items) : new Map<string, any>();
    await mutate(invoice, items, t);
    await t.replace(Invoice, invoiceId, invoice);
  });
}

/** Recomputes subtotal/total from the invoice's items and re-derives billClearDate. */
function recalcFromItems(invoice: any, items: Map<string, any>): void {
  const subtotal = invoice.items.reduce((sum: number, id: string) => {
    const item = items.get(id);
    return item ? sum + item.quantity * item.price : sum;
  }, 0);
  invoice.subtotal = subtotal;
  invoice.total = subtotal - (invoice.discount ?? 0);
  if (sumSettled(invoice.payments) >= invoice.total) invoice.billClearDate = new Date();
  else delete invoice.billClearDate;
}

async function respondWithInvoice(res: Response, invoiceId: string, status = 200) {
  const populated = await populateInvoice(Invoice.findById(invoiceId));
  res.status(status).json(populated);
}

// ── CREATE invoice (one transaction) ─────────────────────────────────────────

interface StockDeduction {
  lensType: string;
  material: string;
  coating: string;
  color: string;
  sph: number;
  cyl: number;
  add: number | null;
}

export const createInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body: CreateInvoiceInput = req.body;
    const { customer: customerIdRaw, customerName, customerMobile, customerAddress, items, discount = 0, billDate: billDateRaw } = body;

    // ── 1. Validate the whole request before anything is written ──────────────
    if (!items || items.length === 0) {
      res.status(400).json({ message: 'At least one item is required.' });
      return;
    }
    const validationError = validateItems(items);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }
    if (typeof discount !== 'number' || discount < 0) {
      res.status(400).json({ message: 'Discount must be a non-negative number.' });
      return;
    }

    let billDate: Date;
    if (billDateRaw) {
      billDate = new Date(billDateRaw);
      if (isNaN(billDate.getTime())) {
        res.status(400).json({ message: 'Invalid billDate. Must be a valid ISO date string.' });
        return;
      }
    } else {
      billDate = new Date();
    }

    const subtotal = items.reduce((sum, i) => sum + i.quantity * i.price, 0);
    if (discount >= subtotal) {
      res.status(400).json({ message: 'Discount cannot be equal to or greater than the subtotal.' });
      return;
    }
    const total = subtotal - discount;

    const { initialPayment, initialPayments: initialPaymentsInput } = body;
    const initialPayments: Array<{ date: Date; amount: number; method: 'cash' | 'online' }> = [];
    let billClearDate: Date | undefined;

    if (initialPaymentsInput && initialPaymentsInput.length > 0) {
      let upfrontTotal = 0;
      for (const payment of initialPaymentsInput) {
        if (typeof payment.amount !== 'number' || payment.amount <= 0) {
          res.status(400).json({ message: 'Each initial payment must have a positive amount.' });
          return;
        }
        if (!payment.method || !['cash', 'online'].includes(payment.method)) {
          res.status(400).json({ message: "Each initial payment must include method 'cash' or 'online'." });
          return;
        }
        const paymentDate = payment.date ? new Date(payment.date) : billDate;
        if (Number.isNaN(paymentDate.getTime())) {
          res.status(400).json({ message: 'Each initial payment date must be valid.' });
          return;
        }
        initialPayments.push({ date: paymentDate, amount: payment.amount, method: payment.method });
        upfrontTotal += payment.amount;
      }
      if (upfrontTotal > total) {
        res.status(400).json({ message: 'Initial payments cannot exceed invoice total.' });
        return;
      }
      if (upfrontTotal === total) billClearDate = billDate;
    } else if (initialPayment !== undefined && initialPayment !== 0) {
      if (typeof initialPayment !== 'number' || initialPayment <= 0) {
        res.status(400).json({ message: 'initialPayment must be a positive number.' });
        return;
      }
      if (initialPayment > total) {
        res.status(400).json({ message: 'Initial payment cannot exceed invoice total.' });
        return;
      }
      initialPayments.push({ date: billDate, amount: initialPayment, method: 'cash' });
      if (initialPayment === total) billClearDate = billDate;
    }

    // ── 2. Lookups (reads only) ───────────────────────────────────────────────
    let existingCustomer: any = null;
    if (isValidId(customerIdRaw)) {
      existingCustomer = await Customer.findById(customerIdRaw);
      if (!existingCustomer) {
        res.status(404).json({ message: 'Customer not found.' });
        return;
      }
    } else if (!customerName?.trim()) {
      res.status(400).json({ message: 'customerName is required when creating a new customer.' });
      return;
    }
    const resolvedCustomerName: string = existingCustomer ? existingCustomer.name : customerName!.trim();

    // Catalog lenses and referenced prescriptions are resolved before the transaction.
    const catalogLens = new Map<number, { existingId?: string; filter: CatalogLensFilter }>();
    const referencedRx = new Map<number, any>();
    const productIds = { frames: new Set<string>(), fragrances: new Set<string>() };

    for (const [i, item] of items.entries()) {
      if (item.type === 'opticalLens') {
        if (isValidId(item.prescription)) {
          const rx = await Prescription.findById(item.prescription);
          if (rx) referencedRx.set(i, rx);
        }
        if (item.lensBrand?.trim() && item.lensName?.trim() && item.lensCategory) {
          const filter: CatalogLensFilter = {
            brand: item.lensBrand.trim(),
            name: item.lensName.trim(),
            category: item.lensCategory,
            index: item.lensIndex || null,
            coating: item.lensCoating || null,
            spherical: item.spherical === undefined ? null : item.spherical,
            cylinder: item.cylinder === undefined ? null : item.cylinder,
            addition: item.addition === undefined ? null : item.addition,
          };
          const found = await findCatalogLens(filter);
          catalogLens.set(i, { existingId: found ? idOf(found._id) : undefined, filter });
        }
      } else if (item.type === 'frame' && isValidId(item.frame)) {
        productIds.frames.add(idOf(item.frame));
      } else if (item.type === 'fragrance' && isValidId(item.fragrance)) {
        productIds.fragrances.add(idOf(item.fragrance));
      }
    }

    const customerKey = existingCustomer ? idOf(existingCustomer._id) : null;
    const [financialSetting, priorInvoicesCount] = await Promise.all([
      SiteSetting.findOne({ key: 'retail_financial_settings' }).lean(),
      customerKey ? Invoice.countDocuments({ customer: customerKey }) : Promise.resolve(0),
    ]);
    const finConfig = financialSetting?.value
      ? { defaultCardSwipeFeePct: 0, defaultPackagingCost: 35, ...financialSetting.value }
      : { defaultCardSwipeFeePct: 0, defaultPackagingCost: 35 };

    const isNewCustomer = priorInvoicesCount === 0;
    const visitNumber = priorInvoicesCount + 1;
    const packagingCost = typeof body.packagingCost === 'number' ? body.packagingCost : finConfig.defaultPackagingCost;
    const onlinePaid = initialPayments.filter((p) => p.method === 'online').reduce((s, p) => s + p.amount, 0);
    const paymentProcessingFee =
      typeof body.paymentProcessingFee === 'number'
        ? body.paymentProcessingFee
        : Number((onlinePaid * (finConfig.defaultCardSwipeFeePct / 100)).toFixed(2));
    const acquisitionSource = body.acquisitionSource || (isNewCustomer ? 'walk_by' : 'repeat');
    const fy = financialYear(billDate);

    // ── 3. One transaction: every write lands together or not at all ─────────
    const invoiceId = await runModelTransaction(async (t) => {
      // Reads first (Firestore requires all reads before writes).
      const [counter] = await t.query<any>(InvoiceCounter, { year: fy }, 1);
      const frames = await t.getMany<any>(Frame, [...productIds.frames]);
      const fragrances = await t.getMany<any>(Fragrance, [...productIds.fragrances]);

      const deductions: StockDeduction[] = [];
      for (const item of items as any[]) {
        if (item.type !== 'opticalLens' || item.isCustomLens) continue;
        const lensType = item.lensType ?? null;
        const material = item.lensMaterial ?? null;
        const coating = item.lensCoating ?? null;
        const color = item.lensColor ?? null;
        if (!lensType || !material || !coating || !color) continue;
        const eye = item.eye ?? 'both';
        const base = { lensType, material, coating, color };
        if ((eye === 'right' || eye === 'both') && (item.rightSpherical ?? null) !== null) {
          deductions.push({ ...base, sph: item.rightSpherical, cyl: item.rightCylinder ?? 0, add: item.rightAddition ?? null });
        }
        if ((eye === 'left' || eye === 'both') && (item.leftSpherical ?? null) !== null) {
          deductions.push({ ...base, sph: item.leftSpherical, cyl: item.leftCylinder ?? 0, add: item.leftAddition ?? null });
        }
      }
      // Each deduction takes one unit from the first matching stock row that still has stock.
      const stockRows = new Map<string, any>();
      const stockTaken = new Map<string, number>();
      for (const d of deductions) {
        const rows = await t.query<any>(LensStock, { ...d });
        for (const r of rows) if (!stockRows.has(r.id)) stockRows.set(r.id, r);
        const row = rows
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .find((r) => (typeof r.quantity === 'number' ? r.quantity : 0) - (stockTaken.get(r.id) ?? 0) > 0);
        if (row) stockTaken.set(row.id, (stockTaken.get(row.id) ?? 0) + 1);
      }

      // Writes.
      const seq = (counter?.lastSeq ?? 0) + 1;
      if (counter) await t.update(InvoiceCounter, counter.id, { lastSeq: seq }, counter);
      else await t.create(InvoiceCounter, { year: fy, lastSeq: seq });
      const invoiceNumber = formatInvoiceNo(seq, fy);

      let customerId = customerKey;
      if (!customerId) {
        const created = await t.create<any>(Customer, {
          name: customerName!.trim(),
          mobileNumber: customerMobile?.trim() || undefined,
          address: customerAddress?.trim() || undefined,
        });
        customerId = created.id as string;
      }

      // Prescriptions, catalog lenses and product price/stock updates.
      const resolved: any[] = [];
      const rxGroups = new Map<string, { userName: string; label: string; items: any[] }>();
      const frameUpdates = new Map<string, any>();
      const fragranceUpdates = new Map<string, any>();

      for (const [i, item] of (items as any[]).entries()) {
        const enhanced: any = { ...item };
        if (item.type === 'opticalLens') {
          let targetUserName = item.userName?.trim() || resolvedCustomerName;
          const rx = referencedRx.get(i);
          if (rx) {
            if (!item.userName?.trim() && rx.userName) targetUserName = rx.userName;
            if (!item.lensLabel?.trim()) enhanced.lensLabel = rx.label;
          } else if (!isValidId(item.prescription) && (item.rightSpherical !== undefined || item.leftSpherical !== undefined)) {
            const label = item.lensLabel?.trim() || item.lensType?.trim() || 'Prescription';
            const rxDoc = await t.create<any>(Prescription, {
              customer: customerId,
              label,
              userName: targetUserName,
              rightSpherical: item.rightSpherical ?? undefined,
              rightCylinder: item.rightCylinder ?? undefined,
              rightAxis: item.rightAxis ?? undefined,
              rightAddition: item.rightAddition ?? undefined,
              leftSpherical: item.leftSpherical ?? undefined,
              leftCylinder: item.leftCylinder ?? undefined,
              leftAxis: item.leftAxis ?? undefined,
              leftAddition: item.leftAddition ?? undefined,
            });
            enhanced._resolvedPrescription = rxDoc.id;
            enhanced.lensLabel = label;
          } else if (!isValidId(item.prescription) && (item.lensLabel?.trim() || item.spherical !== null)) {
            const label = item.lensLabel?.trim() || 'Prescription';
            const key = `${targetUserName}|${label}`;
            if (!rxGroups.has(key)) rxGroups.set(key, { userName: targetUserName, label, items: [] });
            rxGroups.get(key)!.items.push(enhanced);
          }

          const lens = catalogLens.get(i);
          if (lens) {
            if (lens.existingId) {
              await t.update(OpticalLens, lens.existingId, { sellPrice: item.price }, null);
              enhanced._resolvedOpticalLens = lens.existingId;
            } else {
              const created = await t.create<any>(OpticalLens, { ...lens.filter, sellPrice: item.price });
              enhanced._resolvedOpticalLens = created.id;
            }
          }
          enhanced.userName = targetUserName;
        } else if (item.type === 'frame' && isValidId(item.frame)) {
          const id = idOf(item.frame);
          const frame = frames.get(id);
          const update = frameUpdates.get(id) ?? { sellPrice: item.price };
          update.sellPrice = item.price;
          const variants = update['web.frameVariants'] ?? frame?.web?.frameVariants;
          if (item.frameVariantLabel && variants?.length) {
            const idx = variants.findIndex((v: any) => frameVariantName(v) === item.frameVariantLabel);
            if (idx >= 0) {
              const copy = variants.map((v: any) => ({ ...v }));
              copy[idx].stock = Math.max(0, (copy[idx].stock || 0) - (item.quantity || 1));
              update['web.frameVariants'] = copy;
            }
          }
          frameUpdates.set(id, update);
        } else if (item.type === 'fragrance' && isValidId(item.fragrance)) {
          const id = idOf(item.fragrance);
          const fragrance = fragrances.get(id);
          const update = fragranceUpdates.get(id) ?? { sellPrice: item.price };
          update.sellPrice = item.price;
          const grade = item.fragranceGrade || item.fragranceVariantLabel;
          const variants = update.variants ?? fragrance?.variants;
          if (grade && variants?.length) {
            const idx = variants.findIndex((v: any) => v.label === grade);
            if (idx >= 0) {
              const copy = variants.map((v: any) => ({ ...v }));
              copy[idx].stock = Math.max(0, (copy[idx].stock || 0) - (item.quantity || 1));
              update.variants = copy;
            }
          }
          fragranceUpdates.set(id, update);
        }
        resolved.push(enhanced);
      }

      for (const group of rxGroups.values()) {
        const rxDoc: any = { customer: customerId, label: group.label, userName: group.userName };
        for (const i of group.items) {
          if (i.eye === 'right') {
            rxDoc.rightSpherical = i.spherical;
            rxDoc.rightCylinder = i.cylinder;
            rxDoc.rightAxis = i.axis;
            rxDoc.rightAddition = i.addition;
          } else if (i.eye === 'left') {
            rxDoc.leftSpherical = i.spherical;
            rxDoc.leftCylinder = i.cylinder;
            rxDoc.leftAxis = i.axis;
            rxDoc.leftAddition = i.addition;
          }
        }
        const created = await t.create<any>(Prescription, rxDoc);
        for (const i of group.items) i._resolvedPrescription = created.id;
      }

      for (const [id, update] of frameUpdates) await t.update(Frame, id, { $set: update }, frames.get(id) ?? null);
      for (const [id, update] of fragranceUpdates) await t.update(Fragrance, id, { $set: update }, fragrances.get(id) ?? null);

      // Invoice items, already linked to the invoice being created.
      const invoiceDocId = t.newId(Invoice);
      const itemIds: string[] = [];
      let totalCogs = 0;

      for (const item of resolved) {
        let costPrice = typeof item.costPrice === 'number' ? item.costPrice : 0;
        if (costPrice === 0) {
          if (item.type === 'frame' && item.frame) {
            costPrice = frames.get(idOf(item.frame))?.costPrice || 0;
          } else if (item.type === 'fragrance' && item.fragrance) {
            const frag = fragrances.get(idOf(item.fragrance));
            const grade = item.fragranceGrade || item.fragranceVariantLabel;
            const variant = grade && frag?.variants?.length ? frag.variants.find((v: any) => v.label === grade) : null;
            costPrice = variant?.costPrice || frag?.costPrice || 0;
          }
        }
        totalCogs += costPrice * item.quantity;

        const doc: any = {
          type: item.type,
          quantity: item.quantity,
          price: item.price,
          costPrice,
          invoice: invoiceDocId,
          invoiceId: invoiceDocId,
          invoiceNumber,
        };
        if (item.type === 'frame' && item.frame) {
          doc.frame = item.frame;
          if (item.frameVariantLabel) doc.frameVariantLabel = item.frameVariantLabel;
        }
        if (item.type === 'fragrance' && item.fragrance) {
          doc.fragrance = item.fragrance;
          const grade = item.fragranceGrade || item.fragranceVariantLabel;
          if (grade) doc.fragranceGrade = grade;
        }
        if (item.type === 'opticalLens') {
          doc.opticalLens = item._resolvedOpticalLens || item.opticalLens;
          doc.prescription = item._resolvedPrescription || item.prescription;
          doc.eye = item.eye;
          doc.userName = item.userName;
          doc.spherical = item.spherical;
          doc.cylinder = item.cylinder;
          doc.axis = item.axis;
          doc.addition = item.addition;
          doc.lensLabel = item.lensLabel;
          doc.lensBrand = item.lensBrand || null;
          doc.lensName = item.lensName || null;
          doc.lensCategory = item.lensCategory || null;
          doc.lensIndex = item.lensIndex || null;
          doc.lensCoating = item.lensCoating || null;
          doc.lensMaterial = item.lensMaterial || null;
          doc.lensColor = item.lensColor || null;
          doc.isCustomLens = item.isCustomLens || false;
          doc.rightEyeNumber = item.rightEyeNumber || null;
          doc.leftEyeNumber = item.leftEyeNumber || null;
          doc.lensCompany = item.lensCompany || null;
          doc.lensType = item.lensType || null;
          doc.isSameNumber = item.isSameNumber || false;
          doc.rightSpherical = item.rightSpherical ?? null;
          doc.rightCylinder = item.rightCylinder ?? null;
          doc.rightAxis = item.rightAxis ?? null;
          doc.rightAddition = item.rightAddition ?? null;
          doc.leftSpherical = item.leftSpherical ?? null;
          doc.leftCylinder = item.leftCylinder ?? null;
          doc.leftAxis = item.leftAxis ?? null;
          doc.leftAddition = item.leftAddition ?? null;

          const isAlreadyOrdered = !!(item.alreadyOrdered || item.skipWholesalerQueue || item.fulfillmentSource === 'already_ordered');
          const isCounterStock = item.fulfillmentSource === 'stock' && item.sendToWholesaler === false;
          if (isAlreadyOrdered) {
            doc.fulfillmentSource = 'stock';
            doc.sentToWholesaler = true;
            doc.labStatus = 'fitted';
            doc.wholesalerOrderDate = new Date();
          } else if (isCounterStock) {
            doc.fulfillmentSource = 'stock';
            doc.sentToWholesaler = false;
            doc.labStatus = 'fitted';
          } else {
            doc.fulfillmentSource = item.fulfillmentSource || 'ordered';
            doc.sentToWholesaler = item.sentToWholesaler || false;
            doc.labStatus = item.labStatus || 'pending';
          }
          doc.requestedQty = item.requestedQty ?? item.quantity;
          doc.fulfilledQty = item.fulfilledQty ?? item.quantity;
        }
        const created = await t.create<any>(InvoiceItem, doc);
        itemIds.push(created.id);
      }

      const netContributionMargin = Math.max(0, Number((total - totalCogs - packagingCost - paymentProcessingFee).toFixed(2)));
      await t.create(
        Invoice,
        {
          customer: customerId,
          items: itemIds,
          subtotal,
          discount,
          total,
          billDate,
          payments: initialPayments,
          invoiceNumber,
          acquisitionSource,
          totalCogs,
          packagingCost,
          paymentProcessingFee,
          netContributionMargin,
          contributionMarginPct: total > 0 ? Number(((netContributionMargin / total) * 100).toFixed(2)) : 0,
          isNewCustomer,
          visitNumber,
          ...(billClearDate ? { billClearDate } : {}),
        },
        invoiceDocId,
      );

      for (const [rowId, taken] of stockTaken) {
        const row = stockRows.get(rowId);
        const current = typeof row?.quantity === 'number' ? row.quantity : 0;
        await t.update(LensStock, rowId, { quantity: Math.max(0, current - taken) }, row ?? null);
      }

      return invoiceDocId;
    });

    // ── 4. Follow-ups that may fail without affecting the bill ───────────────
    try {
      await createPendingPurchasesForInvoice(invoiceId);
    } catch (purchaseErr) {
      console.warn('[createInvoice] Auto-create pending purchase error:', purchaseErr);
    }

    await respondWithInvoice(res, invoiceId, 201);
  } catch (error) {
    if (sendHttpError(error, res)) return;
    console.error('[createInvoice] failed; transaction rolled back, nothing was written:', error);
    next(error);
  }
};

// ── UPDATE invoice ───────────────────────────────────────────────────────────

const sameInstant = (a: unknown, b: unknown) => {
  const ta = new Date(a as string | Date).getTime();
  const tb = new Date(b as string | Date).getTime();
  return Number.isFinite(ta) && ta === tb;
};

/** True when `next` starts with every payment of `existing`, unchanged and in order. */
export function keepsExistingPayments(existing: IPayment[], next: IPayment[]): boolean {
  if (next.length < existing.length) return false;
  return existing.every((p, i) => {
    const q = next[i];
    return q.amount === p.amount && q.method === p.method && (q.writeoff ?? 0) === (p.writeoff ?? 0) && sameInstant(q.date, p.date);
  });
}

export const updateInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { discount, billDate, payments, packagingCost, acquisitionSource, customer } = req.body as {
      discount?: number;
      billDate?: string;
      payments?: Array<{ amount: number; method: 'cash' | 'online'; date?: string | Date; writeoff?: number }>;
      packagingCost?: number;
      acquisitionSource?: any;
      customer?: any;
    };

    let customerId: string | undefined;
    if (customer !== undefined && customer !== null) {
      const custId = typeof customer === 'object' ? (customer._id || customer.id) : customer;
      if (!isValidId(custId)) {
        res.status(400).json({ message: 'Invalid customer ID.' });
        return;
      }
      const existingCust = await Customer.findById(custId);
      if (!existingCust) {
        res.status(404).json({ message: 'Customer not found.' });
        return;
      }
      customerId = idOf(existingCust._id || existingCust.id);
    }

    await mutateInvoice(String(req.params.id), (invoice) => {
      if (customerId) invoice.customer = customerId;

      if (billDate !== undefined) {
        const d = new Date(billDate);
        if (isNaN(d.getTime())) throw new InvoiceHttpError(400, 'Invalid billDate.');
        invoice.billDate = d;
      }
      if (acquisitionSource !== undefined) invoice.acquisitionSource = acquisitionSource;
      if (packagingCost !== undefined && typeof packagingCost === 'number' && packagingCost >= 0) {
        invoice.packagingCost = packagingCost;
      }

      if (discount !== undefined) {
        if (typeof discount !== 'number' || discount < 0) throw new InvoiceHttpError(400, 'Discount must be a non-negative number.');
        if (discount >= invoice.subtotal && invoice.subtotal > 0) {
          throw new InvoiceHttpError(400, 'Discount cannot equal or exceed the subtotal.');
        }
        invoice.discount = discount;
        invoice.total = Math.max(0, invoice.subtotal - discount);
      }

      if (payments !== undefined) {
        if (!Array.isArray(payments)) throw new InvoiceHttpError(400, 'payments must be an array.');
        const updatedPayments: IPayment[] = [];
        for (const p of payments) {
          if (typeof p.amount !== 'number' || p.amount < 0) {
            throw new InvoiceHttpError(400, 'Payment amount must be a non-negative number.');
          }
          if (!p.method || !['cash', 'online'].includes(p.method)) {
            throw new InvoiceHttpError(400, "Payment method must be 'cash' or 'online'.");
          }
          const writeoff = typeof p.writeoff === 'number' && p.writeoff > 0 ? p.writeoff : 0;
          if (p.amount > 0 || writeoff > 0) {
            const pDate = p.date ? new Date(p.date) : invoice.billDate ?? new Date();
            if (isNaN(pDate.getTime())) throw new InvoiceHttpError(400, 'Invalid payment date.');
            updatedPayments.push({ date: pDate, amount: p.amount, method: p.method, writeoff });
          }
        }
        // Staff may record new payments but not change or remove ones already recorded
        // (correcting past payments is admin-only, as on PATCH/DELETE /:id/payment/:index).
        if (req.user?.role === 'staff' && !keepsExistingPayments(invoice.payments ?? [], updatedPayments)) {
          throw new InvoiceHttpError(403, 'Only the store owner can change payments that are already recorded.');
        }
        const totalPaid = sumSettled(updatedPayments);
        if (totalPaid > invoice.total + 0.01) {
          throw new InvoiceHttpError(
            400,
            `Total payments (₹${totalPaid.toLocaleString('en-IN')}) cannot exceed invoice total (₹${invoice.total.toLocaleString('en-IN')}).`,
          );
        }
        invoice.payments = updatedPayments;
      }

      const totalPaid = sumSettled(invoice.payments);
      if (totalPaid >= invoice.total && invoice.total > 0) {
        invoice.billClearDate = invoice.payments[invoice.payments.length - 1]?.date ?? invoice.billDate ?? new Date();
      } else if (invoice.total === 0 && totalPaid === 0) {
        invoice.billClearDate = invoice.billDate ?? new Date();
      } else {
        delete invoice.billClearDate;
      }

      const onlinePaid = invoice.payments.filter((p: IPayment) => p.method === 'online').reduce((s: number, p: IPayment) => s + p.amount, 0);
      const paymentProcessingFee = Number((onlinePaid * (0.0195 * 1.18)).toFixed(2));
      invoice.paymentProcessingFee = paymentProcessingFee;
      const netContributionMargin = Math.max(
        0,
        Number((invoice.total - (invoice.totalCogs ?? 0) - (invoice.packagingCost ?? 0) - paymentProcessingFee).toFixed(2)),
      );
      invoice.netContributionMargin = netContributionMargin;
      invoice.contributionMarginPct = invoice.total > 0 ? Number(((netContributionMargin / invoice.total) * 100).toFixed(2)) : 0;
    });

    await respondWithInvoice(res, String(req.params.id));
  } catch (error) {
    if (sendHttpError(error, res)) return;
    next(error);
  }
};

// ── ADD payment ──────────────────────────────────────────────────────────────

export const addPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, date, method, writeoff } = req.body as {
      amount?: number;
      date?: string;
      method?: 'cash' | 'online';
      writeoff?: number;
    };

    if (typeof amount !== 'number' || amount < 0) {
      res.status(400).json({ message: 'Amount must be a non-negative number.' });
      return;
    }
    if (!method || !['cash', 'online'].includes(method)) {
      res.status(400).json({ message: "method is required and must be 'cash' or 'online'." });
      return;
    }
    const discountAmount = writeoff ?? 0;
    if (typeof discountAmount !== 'number' || discountAmount < 0) {
      res.status(400).json({ message: 'Discount must be a non-negative number.' });
      return;
    }
    if (amount + discountAmount <= 0) {
      res.status(400).json({ message: 'Amount and discount cannot both be zero.' });
      return;
    }

    await mutateInvoice(String(req.params.id), (invoice) => {
      // A write-off is added to the invoice-level discount.
      const newDiscount = invoice.discount + discountAmount;
      if (discountAmount > 0 && newDiscount >= invoice.subtotal) {
        throw new InvoiceHttpError(400, 'Discount cannot equal or exceed the invoice subtotal.');
      }

      // Validate against the balance before this write-off is applied.
      const alreadyPaid = invoice.payments.reduce((sum: number, p: IPayment) => sum + p.amount, 0);
      if (amount + discountAmount > invoice.total - alreadyPaid + 0.01) {
        throw new InvoiceHttpError(400, 'Payment and discount exceed the outstanding balance.');
      }

      if (discountAmount > 0) {
        invoice.discount = newDiscount;
        invoice.total = invoice.subtotal - newDiscount;
      }

      const paymentDate = date ? new Date(date) : new Date();
      if (amount > 0) invoice.payments.push({ date: paymentDate, amount, method });

      if (sumSettled(invoice.payments) >= invoice.total) invoice.billClearDate = paymentDate;
      else delete invoice.billClearDate;
    });

    await respondWithInvoice(res, String(req.params.id));
  } catch (error) {
    if (sendHttpError(error, res)) return;
    next(error);
  }
};

// ── UPDATE payment ───────────────────────────────────────────────────────────

export const updatePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const index = parseInt(String(req.params.paymentIndex), 10);
    const { amount, method, date } = req.body as {
      amount?: number;
      method?: 'cash' | 'online';
      date?: string;
    };

    if (amount !== undefined && (typeof amount !== 'number' || amount <= 0)) {
      res.status(400).json({ message: 'amount must be a positive number.' });
      return;
    }
    if (method !== undefined && !['cash', 'online'].includes(method)) {
      res.status(400).json({ message: "method must be 'cash' or 'online'." });
      return;
    }
    const parsedDate = date !== undefined ? new Date(date) : undefined;
    if (parsedDate && Number.isNaN(parsedDate.getTime())) {
      res.status(400).json({ message: 'Invalid payment date.' });
      return;
    }

    await mutateInvoice(String(req.params.id), (invoice) => {
      if (isNaN(index) || index < 0 || index >= invoice.payments.length) {
        throw new InvoiceHttpError(400, 'Invalid payment index');
      }
      const payment = invoice.payments[index];
      if (amount !== undefined) payment.amount = amount;
      if (method !== undefined) payment.method = method;
      if (parsedDate) payment.date = parsedDate;

      const totalSettled = sumSettled(invoice.payments);
      if (totalSettled > invoice.total + 0.01) throw new InvoiceHttpError(400, 'Total payments exceed invoice total.');
      if (totalSettled >= invoice.total) {
        invoice.billClearDate = invoice.payments[invoice.payments.length - 1]?.date ?? new Date();
      } else {
        delete invoice.billClearDate;
      }
    });

    await respondWithInvoice(res, String(req.params.id));
  } catch (error) {
    if (sendHttpError(error, res)) return;
    next(error);
  }
};

// ── DELETE payment ───────────────────────────────────────────────────────────

export const deletePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const index = parseInt(String(req.params.paymentIndex), 10);

    await mutateInvoice(String(req.params.id), (invoice) => {
      if (isNaN(index) || index < 0 || index >= invoice.payments.length) {
        throw new InvoiceHttpError(400, 'Invalid payment index');
      }
      invoice.payments.splice(index, 1);
      if (sumSettled(invoice.payments) >= invoice.total) {
        invoice.billClearDate = invoice.payments[invoice.payments.length - 1]?.date ?? new Date();
      } else {
        delete invoice.billClearDate;
      }
    });

    await respondWithInvoice(res, String(req.params.id));
  } catch (error) {
    if (sendHttpError(error, res)) return;
    next(error);
  }
};

// ── DELETE invoice ───────────────────────────────────────────────────────────

export const deleteInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = String(req.params.id);

    await runModelTransaction(async (t) => {
      const invoice = await t.get<any>(Invoice, invoiceId);
      if (!invoice) throw new InvoiceHttpError(404, 'Invoice not found');
      const itemIds: string[] = (invoice.items ?? []).map(idOf);
      const items = await t.getMany<any>(InvoiceItem, itemIds);

      // Restore frame variant stock for frame items that had a colour selected.
      const frameIds = [...items.values()].filter((i) => i.frame && i.frameVariantLabel).map((i) => idOf(i.frame));
      const frames = await t.getMany<any>(Frame, frameIds);
      const restored = new Map<string, any[]>();
      for (const item of items.values()) {
        if (!item.frame || !item.frameVariantLabel) continue;
        const id = idOf(item.frame);
        const variants = restored.get(id) ?? frames.get(id)?.web?.frameVariants?.map((v: any) => ({ ...v }));
        if (!variants?.length) continue;
        const idx = variants.findIndex((v: any) => frameVariantName(v) === item.frameVariantLabel);
        if (idx >= 0) {
          variants[idx].stock = (variants[idx].stock || 0) + item.quantity;
          restored.set(id, variants);
        }
      }

      for (const [id, variants] of restored) {
        await t.update(Frame, id, { $set: { 'web.frameVariants': variants } }, frames.get(id) ?? null);
      }
      for (const id of itemIds) t.delete(InvoiceItem, id);
      t.delete(Invoice, invoiceId);
    });

    await PurchaseEntry.deleteMany({ purchaseInvoiceId: invoiceId, status: 'pending' }).catch(() => {});
    invalidateInvoiceLookupCache();
    res.json({ message: 'Invoice deleted' });
  } catch (error) {
    if (sendHttpError(error, res)) return;
    next(error);
  }
};

// ── ADD Item ─────────────────────────────────────────────────────────────────

export const addItemToInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = String(req.params.id);
    const body = req.body as any;

    // Lens items without a catalog reference are matched to (or added to) the lens catalog.
    const isLens =
      body.type === 'opticalLens' ||
      (!body.type && !body.frame && !body.fragrance && (
        Boolean(body.lensBrand) ||
        Boolean(body.lensName) ||
        Boolean(body.lensType) ||
        Boolean(body.lensLabel) ||
        body.rightSpherical !== undefined ||
        body.leftSpherical !== undefined
      ));

    let newCatalogLens: CatalogLensFilter | null = null;
    if (isLens && (!body.opticalLens || !isValidId(body.opticalLens))) {
      const filter: CatalogLensFilter = {
        brand: body.lensBrand?.trim() || body.lensCompany?.trim() || 'Custom',
        name: body.lensName?.trim() || body.lensType?.trim() || 'Single Vision',
        category: body.lensCategory || body.lensType || 'Single Vision',
        index: body.lensIndex || null,
        coating: body.lensCoating || null,
        spherical: body.spherical === undefined ? null : body.spherical,
        cylinder: body.cylinder === undefined ? null : body.cylinder,
        addition: body.addition === undefined ? null : body.addition,
      };
      const found = await findCatalogLens(filter);
      if (found) body.opticalLens = idOf(found._id);
      else newCatalogLens = filter;
    }

    const refCount = [body.frame, body.opticalLens || newCatalogLens, body.fragrance].filter(Boolean).length;
    if (refCount > 1) {
      res.status(400).json({ message: 'Each invoice item cannot reference more than one of: frame, opticalLens, fragrance' });
      return;
    }
    if (typeof body.quantity !== 'number' || body.quantity <= 0) {
      res.status(400).json({ message: 'Quantity must be a positive number.' });
      return;
    }
    if (typeof body.price !== 'number' || body.price < 0) {
      res.status(400).json({ message: 'Price must be a non-negative number.' });
      return;
    }

    await mutateInvoice(
      invoiceId,
      async (invoice, items, t) => {
        if (newCatalogLens) {
          const created = await t.create<any>(OpticalLens, { ...newCatalogLens, sellPrice: body.price });
          body.opticalLens = created.id;
        }

        const doc: any = {
          quantity: body.quantity,
          price: body.price,
          invoice: invoiceId,
          invoiceId,
          invoiceNumber: invoice.invoiceNumber,
        };
        if ((body.type === 'frame' || body.frame) && body.frame) doc.frame = body.frame;
        if ((body.type === 'fragrance' || body.fragrance) && body.fragrance) {
          doc.fragrance = body.fragrance;
          if (body.fragranceGrade) doc.fragranceGrade = body.fragranceGrade;
        }
        if (isLens || body.type === 'opticalLens' || body.opticalLens) {
          if (body.opticalLens) doc.opticalLens = body.opticalLens;
          doc.prescription = body.prescription;
          doc.eye = body.eye || 'both';
          doc.userName = body.userName;
          doc.spherical = body.spherical;
          doc.cylinder = body.cylinder;
          doc.axis = body.axis;
          doc.addition = body.addition;
          doc.lensLabel = body.lensLabel;
          doc.lensBrand = body.lensBrand || null;
          doc.lensName = body.lensName || null;
          doc.lensCategory = body.lensCategory || null;
          doc.lensIndex = body.lensIndex || null;
          doc.lensCoating = body.lensCoating || null;
          doc.lensMaterial = body.lensMaterial || null;
          doc.lensColor = body.lensColor || null;
          doc.lensCompany = body.lensCompany || null;
          doc.lensType = body.lensType || null;
          doc.rightEyeNumber = body.rightEyeNumber || null;
          doc.leftEyeNumber = body.leftEyeNumber || null;
          doc.rightSpherical = body.rightSpherical;
          doc.rightCylinder = body.rightCylinder;
          doc.rightAxis = body.rightAxis;
          doc.rightAddition = body.rightAddition;
          doc.leftSpherical = body.leftSpherical;
          doc.leftCylinder = body.leftCylinder;
          doc.leftAxis = body.leftAxis;
          doc.leftAddition = body.leftAddition;
          doc.isCustomLens = body.isCustomLens ?? !body.opticalLens;
        }

        const created = await t.create<any>(InvoiceItem, doc);
        invoice.items.push(created.id);
        items.set(created.id, created);
        recalcFromItems(invoice, items);
      },
      { loadItems: true },
    );

    try {
      await createPendingPurchasesForInvoice(invoiceId);
    } catch (purchaseErr) {
      console.warn('[addItemToInvoice] Auto-create pending purchase error:', purchaseErr);
    }

    await respondWithInvoice(res, invoiceId);
  } catch (error) {
    if (sendHttpError(error, res)) return;
    next(error);
  }
};

// ── REMOVE Item ──────────────────────────────────────────────────────────────

export const removeItemFromInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = String(req.params.id);
    const index = parseInt(String(req.params.itemIndex), 10);

    await mutateInvoice(
      invoiceId,
      (invoice, items, t) => {
        if (invoice.items.length <= 1) throw new InvoiceHttpError(400, 'Invoice must have at least one item');
        if (isNaN(index) || index < 0 || index >= invoice.items.length) throw new InvoiceHttpError(400, 'Invalid item index');

        const [removedId] = invoice.items.splice(index, 1);
        t.delete(InvoiceItem, removedId);
        items.delete(removedId);
        recalcFromItems(invoice, items);
      },
      { loadItems: true },
    );

    await respondWithInvoice(res, invoiceId);
  } catch (error) {
    if (sendHttpError(error, res)) return;
    next(error);
  }
};

// ── RENUMBER all existing invoices ───────────────────────────────────────────
// POST /api/invoices/renumber
// Assigns INVxxxx/YY-YY numbers to all invoices ordered by billDate ASC.
// Safe to call multiple times — re-assigns all numbers from scratch.

export const renumberAllInvoices = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await InvoiceCounter.deleteMany({});

    const invoices = await Invoice.find({}).sort({ billDate: 1, createdAt: 1 }).select('_id billDate').lean();

    const byYear: Record<string, typeof invoices> = {};
    for (const inv of invoices) {
      const fy = financialYear(new Date(inv.billDate));
      if (!byYear[fy]) byYear[fy] = [];
      byYear[fy].push(inv);
    }

    let totalUpdated = 0;
    const summary: Record<string, number> = {};

    for (const [fy, fyInvoices] of Object.entries(byYear)) {
      let seq = 0;
      const bulkOps = fyInvoices.map((inv) => {
        seq++;
        return {
          updateOne: {
            filter: { _id: inv._id },
            update: { $set: { invoiceNumber: formatInvoiceNo(seq, fy) } },
          },
        };
      });
      await Invoice.bulkWrite(bulkOps);
      await InvoiceCounter.findOneAndUpdate(
        { year: fy },
        { lastSeq: seq },
        { upsert: true }
      );
      totalUpdated += seq;
      summary[fy] = seq;
    }

    res.json({ message: `Renumbered ${totalUpdated} invoice(s)`, summary });
  } catch (error) {
    next(error);
  }
};

// ── UPDATE Item Inline ───────────────────────────────────────────────────────

const EDITABLE_ITEM_FIELDS = [
  'frameVariantLabel',
  'lensLabel', 'lensBrand', 'lensCompany', 'lensName', 'lensCategory', 'lensType', 'lensIndex',
  'lensCoating', 'lensMaterial', 'lensColor', 'isCustomLens', 'eye', 'prescription', 'userName',
  'rightEyeNumber', 'leftEyeNumber',
  'rightSpherical', 'rightCylinder', 'rightAxis', 'rightAddition',
  'leftSpherical', 'leftCylinder', 'leftAxis', 'leftAddition',
] as const;

export const updateItemInInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = String(req.params.id);
    const itemId = String(req.params.itemId);
    const { quantity, price, fragranceGrade } = req.body;
    // Descriptive fields an edit may change (lens spec, Rx powers, frame colour). Money and stock
    // links (frame / fragrance / opticalLens ids) are not editable here.
    const descriptive: Record<string, unknown> = {};
    for (const key of EDITABLE_ITEM_FIELDS) {
      if (req.body[key] !== undefined) descriptive[key] = req.body[key];
    }

    if (typeof quantity !== 'number' || quantity <= 0) {
      res.status(400).json({ message: 'Quantity must be a positive number.' });
      return;
    }
    if (typeof price !== 'number' || price < 0) {
      res.status(400).json({ message: 'Price must be a non-negative number.' });
      return;
    }

    await mutateInvoice(
      invoiceId,
      async (invoice, items, t) => {
        if (!invoice.items.includes(itemId)) throw new InvoiceHttpError(400, 'Item does not belong to this invoice');
        const existing = items.get(itemId) ?? null;
        const update: Record<string, any> = { ...descriptive, quantity, price };
        if (fragranceGrade !== undefined) update.fragranceGrade = fragranceGrade;
        await t.update(InvoiceItem, itemId, update, existing);
        if (existing) items.set(itemId, { ...existing, ...update });
        recalcFromItems(invoice, items);
      },
      { loadItems: true },
    );

    await respondWithInvoice(res, invoiceId);
  } catch (error) {
    if (sendHttpError(error, res)) return;
    next(error);
  }
};

// ── DOWNLOAD today's invoices as Excel ───────────────────────────────────────

export const downloadTodayExcel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const [invoices, coatingMap] = await Promise.all([
      populateInvoice(Invoice.find({ billDate: { $gte: startOfDay, $lte: endOfDay } }).sort({ billDate: 1 })),
      getCoatingShortNames(),
    ]);

    const rows: Record<string, unknown>[] = [];

    for (const inv of invoices as any[]) {
      const customer = inv.customer as any;
      const lensItems = (inv.items as any[]).filter((item: any) => !item.frame && !item.fragrance);
      for (const lensItem of lensItems) {
        rows.push({
          SHOP:    'AOH',
          INVOICE: inv.invoiceNumber ?? '',
          NAME:    customer?.name ?? '',
          DATE:    toExcelDate(new Date(inv.billDate)),
          LENS:    buildLensName(lensItem, coatingMap),
          RESPH:   lensItem.rightSpherical  ?? '',
          RECYL:   lensItem.rightCylinder   ?? '',
          REAXIS:  lensItem.rightAxis       ?? '',
          READD:   lensItem.rightAddition   ?? '',
          LESPH:   lensItem.leftSpherical   ?? '',
          LECYL:   lensItem.leftCylinder    ?? '',
          LEAXIS:  lensItem.leftAxis        ?? '',
          LEADD:   lensItem.leftAddition    ?? '',
        });
      }
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['SHOP','INVOICE','NAME','DATE','LENS','RESPH','RECYL','REAXIS','READD','LESPH','LECYL','LEAXIS','LEADD'],
    });
    applyDateFormat(ws);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="lens-${dateStr}.xlsx"`);
    res.send(buf);
  } catch (error) {
    next(error);
  }
};

// ── PUSH Invoice row to lensPrint.xlsx ───────────────────────────────────────

const LENS_PRINT_PATH = 'C:\\Users\\abbas\\Downloads\\lensPrint.xlsx';

const DATE_FMT = 'DD-MMM-YY';
const DATE_COL = 3; // 0-indexed: SHOP=0,INVOICE=1,NAME=2,DATE=3

function toExcelDate(d: Date): number {
  return Math.round((d.getTime() - new Date(Date.UTC(1899, 11, 30)).getTime()) / 86400000);
}

function applyDateFormat(ws: XLSX.WorkSheet) {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const cellRef = XLSX.utils.encode_cell({ r, c: DATE_COL });
    if (ws[cellRef] && ws[cellRef].t === 'n') {
      ws[cellRef].z = DATE_FMT;
    }
  }
}

async function getCoatingShortNames(): Promise<Map<string, string>> {
  const coatings = await Coating.find({ shortName: { $ne: null, $exists: true } }).lean();
  const map = new Map<string, string>();
  for (const c of coatings) {
    if (c.shortName) map.set(c.name, c.shortName);
  }
  return map;
}

function buildLensName(item: any, coatingShortNames: Map<string, string> = new Map()): string {
  const parts: string[] = [];

  const color = (item.lensColor ?? '').trim();
  if (color === 'Photo Chromatic') parts.push('PG');
  else if (color === 'Polarized') parts.push('Polarize');
  else if (/gradal/i.test(color)) parts.push('GRD');
  // White or empty → nothing

  const material = (item.lensMaterial ?? '').trim();
  if (material === 'Fiber') parts.push('CR');
  else if (material === 'Glass') parts.push('Glass');
  else if (material === 'Polycarbonate') parts.push('PC');

  const coatingName = (item.lensCoating ?? '').trim();
  if (coatingName) {
    parts.push(coatingShortNames.get(coatingName) || coatingName);
  }

  const lensType = (item.lensType ?? '').trim();
  if (lensType === 'Bifocal') parts.push('KT');
  else if (lensType === 'Progressive') parts.push('Progressive');
  // Single Vision → nothing

  return parts.join(' ') || (item.lensLabel ?? '').trim() || 'Lens';
}

export const pushToExcel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = await populateInvoice(Invoice.findById(req.params.id));
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }

    const customer = invoice.customer as any;
    const lensItem = (invoice.items as any[]).find((item: any) => !item.frame && !item.fragrance);
    if (!lensItem) {
      res.status(400).json({ message: 'No optical lens item on this invoice' });
      return;
    }

    const coatingMap = await getCoatingShortNames();
    const lensName = buildLensName(lensItem, coatingMap);

    const row = {
      SHOP: 'AOH',
      INVOICE: invoice.invoiceNumber ?? '',
      NAME: customer?.name ?? '',
      DATE: toExcelDate(new Date(invoice.billDate)),
      LENS: lensName,
      RESPH: lensItem.rightSpherical ?? '',
      RECYL: lensItem.rightCylinder ?? '',
      REAXIS: lensItem.rightAxis ?? '',
      READD: lensItem.rightAddition ?? '',
      LESPH: lensItem.leftSpherical ?? '',
      LECYL: lensItem.leftCylinder ?? '',
      LEAXIS: lensItem.leftAxis ?? '',
      LEADD: lensItem.leftAddition ?? '',
    };

    const wb = XLSX.readFile(LENS_PRINT_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    XLSX.utils.sheet_add_json(ws, [row], { skipHeader: true, origin: -1 });
    applyDateFormat(ws);
    XLSX.writeFile(wb, LENS_PRINT_PATH);

    res.json({ message: 'Row added to lensPrint.xlsx', row });
  } catch (error) {
    next(error);
  }
};

// ── LOG unfulfilled demand (no invoice created) ───────────────────────────────

export const logDemand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as DemandLogInput;
    if (typeof body.requestedQty !== 'number' || body.requestedQty <= 0) {
      res.status(400).json({ message: 'requestedQty must be a positive number.' });
      return;
    }
    const doc: any = {
      quantity: body.requestedQty,
      price: 0,
      fulfillmentSource: 'unfulfilled',
      requestedQty: body.requestedQty,
      fulfilledQty: 0,
      lensType: body.lensType || null,
      lensMaterial: body.lensMaterial || null,
      lensCoating: body.lensCoating || null,
      lensColor: body.lensColor || null,
      lensCompany: body.lensCompany || null,
      lensLabel: body.lensLabel || null,
      userName: body.customerName || null,
      rightSpherical: body.rightSpherical ?? null,
      rightCylinder: body.rightCylinder ?? null,
      rightAxis: body.rightAxis ?? null,
      rightAddition: body.rightAddition ?? null,
      leftSpherical: body.leftSpherical ?? null,
      leftCylinder: body.leftCylinder ?? null,
      leftAxis: body.leftAxis ?? null,
      leftAddition: body.leftAddition ?? null,
    };
    const item = await InvoiceItem.create(doc);
    res.status(201).json(item);
  } catch (error) {
    next(error);
  }
};
