import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { Prescription } from '../models/Prescription.model';
import { OpticalNumber } from '../models/OpticalNumber.model';
import { Customer } from '../models/Customer.model';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { deductLensStock } from './lensStock.controller';
import { generateInvoiceNumber, financialYear, formatInvoiceNo } from '../utils/invoiceNumber';
import { InvoiceCounter } from '../models/InvoiceCounter.model';
import type { CreateInvoiceInput, CreateInvoiceItemInput } from '../types';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    const invoices = await populateInvoice(Invoice.find().sort({ billDate: -1 }));
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
      Invoice.find({ customer: req.params.customerId }).sort({ billDate: -1 })
    );
    res.json(invoices);
  } catch (error) {
    next(error);
  }
};

// ── CREATE invoice (unified — atomic) ────────────────────────────────────────

export const createInvoice = async (req: Request, res: Response, next: NextFunction) => {
  // Track created docs for rollback
  const createdInvoiceItemIds: mongoose.Types.ObjectId[] = [];
  const createdOpticalNumberIds: mongoose.Types.ObjectId[] = [];
  const createdPrescriptionIds: mongoose.Types.ObjectId[] = [];
  let createdCustomerId: mongoose.Types.ObjectId | null = null;

  try {
    const body: CreateInvoiceInput = req.body;
    const { customer: customerIdRaw, customerName, customerMobile, customerAddress, items, discount = 0, billDate: billDateRaw } = body;

    // ── 1. Validate items ────────────────────────────────────────────────────
    if (!items || items.length === 0) {
      res.status(400).json({ message: 'At least one item is required.' });
      return;
    }
    const validationError = validateItems(items);
    if (validationError) {
      res.status(400).json({ message: validationError });
      return;
    }

    // ── 2. Validate discount ─────────────────────────────────────────────────
    if (typeof discount !== 'number' || discount < 0) {
      res.status(400).json({ message: 'Discount must be a non-negative number.' });
      return;
    }

    // ── 3. Validate billDate ────────────────────────────────────────────────
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

    // ── 4. Resolve customer ──────────────────────────────────────────────────
    let customerId: mongoose.Types.ObjectId;
    let resolvedCustomerName: string = 'Customer';

    if (customerIdRaw && mongoose.isValidObjectId(customerIdRaw)) {
      const existing = await Customer.findById(customerIdRaw);
      if (!existing) {
        res.status(404).json({ message: 'Customer not found.' });
        return;
      }
      customerId = existing._id as mongoose.Types.ObjectId;
      resolvedCustomerName = existing.name;
    } else {
      if (!customerName?.trim()) {
        res.status(400).json({ message: 'customerName is required when creating a new customer.' });
        return;
      }
      const newCustomer = await Customer.create({
        name: customerName.trim(),
        mobileNumber: customerMobile?.trim() || undefined,
        address: customerAddress?.trim() || undefined,
      });
      customerId = newCustomer._id as mongoose.Types.ObjectId;
      createdCustomerId = customerId;
      resolvedCustomerName = newCustomer.name;
    }

    // ── 5. Create inline OpticalNumbers / Prescriptions ──────────────────────
    const resolvedItems: any[] = [];
    const newPrescriptionGroups = new Map<string, { userName: string; label: string; items: any[] }>();

    console.log(`[createInvoice] Processing ${items.length} items`);

    for (const item of items) {
      if (item.type === 'opticalLens') {
        const enhancedItem: any = { ...item };
        let targetUserName = item.userName?.trim() || resolvedCustomerName;

        if (item.prescription && mongoose.isValidObjectId(item.prescription)) {
          const rx = await Prescription.findById(item.prescription);
          if (rx) {
            if (!item.userName?.trim() && rx.userName) targetUserName = rx.userName;
            if (!item.lensLabel?.trim()) enhancedItem.lensLabel = rx.label;
          }
        } else if ((item as any).rightSpherical !== undefined || (item as any).leftSpherical !== undefined) {
          // New-style: both eyes encoded in a single item
          const label = item.lensLabel?.trim() || (item as any).lensType?.trim() || 'Prescription';
          const rxDoc = await Prescription.create({
            customer: customerId,
            label,
            userName: targetUserName,
            rightSpherical: (item as any).rightSpherical ?? undefined,
            rightCylinder: (item as any).rightCylinder ?? undefined,
            rightAxis: (item as any).rightAxis ?? undefined,
            rightAddition: (item as any).rightAddition ?? undefined,
            leftSpherical: (item as any).leftSpherical ?? undefined,
            leftCylinder: (item as any).leftCylinder ?? undefined,
            leftAxis: (item as any).leftAxis ?? undefined,
            leftAddition: (item as any).leftAddition ?? undefined,
          });
          createdPrescriptionIds.push(rxDoc._id as mongoose.Types.ObjectId);
          enhancedItem._resolvedPrescription = rxDoc._id;
          enhancedItem.lensLabel = label;
        } else if (item.lensLabel?.trim() || item.spherical !== null) {
          const label = item.lensLabel?.trim() || "Prescription";
          const groupKey = `${targetUserName}|${label}`;
          if (!newPrescriptionGroups.has(groupKey)) {
            newPrescriptionGroups.set(groupKey, { userName: targetUserName, label: label, items: [] });
          }
          newPrescriptionGroups.get(groupKey)!.items.push(enhancedItem);
        }

        // Auto-Catalogue Sync
        if (item.lensBrand?.trim() && item.lensName?.trim() && item.lensCategory) {
          const filter = {
            brand: item.lensBrand.trim(),
            name: item.lensName.trim(),
            category: item.lensCategory,
            index: item.lensIndex || null,
            coating: item.lensCoating || null,
            spherical: item.spherical === undefined ? null : item.spherical,
            cylinder: item.cylinder === undefined ? null : item.cylinder,
            addition: item.addition === undefined ? null : item.addition,
          };

          let lensDoc = await OpticalLens.findOne({
            brand: { $regex: new RegExp(`^${escapeRegExp(filter.brand)}$`, 'i') },
            name: { $regex: new RegExp(`^${escapeRegExp(filter.name)}$`, 'i') },
            category: filter.category,
            index: filter.index,
            coating: filter.coating,
            spherical: filter.spherical,
            cylinder: filter.cylinder,
            addition: filter.addition,
          } as any);

          if (!lensDoc) {
            try {
              lensDoc = await OpticalLens.create({ ...filter, sellPrice: item.price } as any);
            } catch (err: any) {
              if (err.code === 11000) {
                lensDoc = await OpticalLens.findOne(filter as any);
              } else {
                throw err;
              }
            }
          }

          if (lensDoc) {
            // Update sell price even for existing lenses
            await OpticalLens.findByIdAndUpdate(lensDoc._id, { sellPrice: item.price });
            enhancedItem._resolvedOpticalLens = lensDoc._id;
          }
        }

        enhancedItem.userName = targetUserName;
        resolvedItems.push(enhancedItem);
      } else if (item.type === 'frame') {
        if (item.frame && mongoose.isValidObjectId(item.frame)) {
          await Frame.findByIdAndUpdate(item.frame, { sellPrice: item.price });
        }
        resolvedItems.push({ ...(item as any) });
      } else if (item.type === 'fragrance') {
        if (item.fragrance && mongoose.isValidObjectId(item.fragrance)) {
          await Fragrance.findByIdAndUpdate(item.fragrance, { sellPrice: item.price });
        }
        resolvedItems.push({ ...(item as any) });
      } else {
        resolvedItems.push({ ...(item as any) });
      }
    }

    // Process new inline prescriptions
    for (const group of Array.from(newPrescriptionGroups.values())) {
      const rxDoc: any = {
        customer: customerId,
        label: group.label,
        userName: group.userName,
      };

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

      const newPrescription = await Prescription.create(rxDoc);
      createdPrescriptionIds.push(newPrescription._id as mongoose.Types.ObjectId);

      for (const i of group.items) {
        i._resolvedPrescription = newPrescription._id;
      }
    }

    // ── 6. Create InvoiceItems ───────────────────────────────────────────────
    const invoiceItemIds: mongoose.Types.ObjectId[] = [];

    for (const item of resolvedItems) {
      const doc: any = {
        quantity: item.quantity,
        price: item.price,
      };
      if (item.type === 'frame' && item.frame) doc.frame = item.frame;
      if (item.type === 'fragrance' && item.fragrance) doc.fragrance = item.fragrance;
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
        doc.lensMaterial = (item as any).lensMaterial || null;
        doc.lensColor = (item as any).lensColor || null;
        doc.isCustomLens = (item as any).isCustomLens || false;
        // Simplified Prescription (legacy string format)
        doc.rightEyeNumber = item.rightEyeNumber || null;
        doc.leftEyeNumber = item.leftEyeNumber || null;
        doc.lensCompany = item.lensCompany || null;
        doc.lensType = item.lensType || null;
        doc.isSameNumber = item.isSameNumber || false;
        // Structured prescription fields
        doc.rightSpherical = (item as any).rightSpherical ?? null;
        doc.rightCylinder = (item as any).rightCylinder ?? null;
        doc.rightAxis = (item as any).rightAxis ?? null;
        doc.rightAddition = (item as any).rightAddition ?? null;
        doc.leftSpherical = (item as any).leftSpherical ?? null;
        doc.leftCylinder = (item as any).leftCylinder ?? null;
        doc.leftAxis = (item as any).leftAxis ?? null;
        doc.leftAddition = (item as any).leftAddition ?? null;
      }

      const invoiceItem = await InvoiceItem.create(doc);
      createdInvoiceItemIds.push(invoiceItem._id as mongoose.Types.ObjectId);
      invoiceItemIds.push(invoiceItem._id as mongoose.Types.ObjectId);
    }

    // ── 7. Calculate totals ──────────────────────────────────────────────────
    const subtotal = resolvedItems.reduce((sum, i) => sum + i.quantity * i.price, 0);

    if (discount >= subtotal) {
      res.status(400).json({ message: 'Discount cannot be equal to or greater than the subtotal.' });
      return;
    }
    const total = subtotal - discount;

    // ── 8. Resolve initialPayment ─────────────────────────────────────────────
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

        initialPayments.push({
          date: paymentDate,
          amount: payment.amount,
          method: payment.method,
        });
        upfrontTotal += payment.amount;
      }

      if (upfrontTotal > total) {
        res.status(400).json({ message: 'Initial payments cannot exceed invoice total.' });
        return;
      }

      if (upfrontTotal === total) {
        billClearDate = billDate;
      }
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
      if (initialPayment === total) {
        billClearDate = billDate;
      }
    }

    // ── 9. Create Invoice ────────────────────────────────────────────────────
    const invoiceNumber = await generateInvoiceNumber(billDate);
    const invoice = await Invoice.create({
      customer: customerId,
      items: invoiceItemIds,
      subtotal,
      discount,
      total,
      billDate,
      payments: initialPayments,
      invoiceNumber,
      ...(billClearDate ? { billClearDate } : {}),
    });

    // ── 10. Auto-deduct lens stock (best-effort) ─────────────────────────────
    for (const item of resolvedItems) {
      if (item.type !== 'opticalLens') continue;
      if ((item as any).isCustomLens) continue;
      const lensType   = item.lensType   ?? null;
      const material   = (item as any).lensMaterial ?? null;
      const coating    = item.lensCoating ?? null;
      const color      = (item as any).lensColor ?? null;
      const eye        = (item as any).eye ?? 'both';
      if (!lensType || !material) continue;
      const base = { lensType, material, coating, color };
      try {
        if (eye === 'right' || eye === 'both') {
          const sph = (item as any).rightSpherical ?? null;
          if (sph !== null) {
            await deductLensStock({
              ...base,
              sph,
              cyl: (item as any).rightCylinder ?? 0,
              add: (item as any).rightAddition ?? null,
            });
          }
        }
        if (eye === 'left' || eye === 'both') {
          const sph = (item as any).leftSpherical ?? null;
          if (sph !== null) {
            await deductLensStock({
              ...base,
              sph,
              cyl: (item as any).leftCylinder ?? 0,
              add: (item as any).leftAddition ?? null,
            });
          }
        }
      } catch (stockErr) {
        console.warn('[createInvoice] Stock deduction warning:', stockErr);
      }
    }

    const populated = await populateInvoice(Invoice.findById(invoice._id));
    res.status(201).json(populated);
  } catch (error) {
    console.error('[createInvoice] Critical failure, rolling back:', error);
    if (createdInvoiceItemIds.length > 0) {
      await InvoiceItem.deleteMany({ _id: { $in: createdInvoiceItemIds } }).catch(() => { });
    }
    if (createdOpticalNumberIds.length > 0) {
      await OpticalNumber.deleteMany({ _id: { $in: createdOpticalNumberIds } }).catch(() => { });
    }
    if (createdPrescriptionIds.length > 0) {
      await Prescription.deleteMany({ _id: { $in: createdPrescriptionIds } }).catch(() => { });
    }
    next(error);
  }
};

// ── UPDATE invoice ───────────────────────────────────────────────────────────

export const updateInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { discount, billDate } = req.body as { discount?: number; billDate?: string };

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }

    if (billDate !== undefined) {
      const d = new Date(billDate);
      if (isNaN(d.getTime())) {
        res.status(400).json({ message: 'Invalid billDate.' });
        return;
      }
      invoice.billDate = d;
    }

    if (discount !== undefined) {
      if (typeof discount !== 'number' || discount < 0) {
        res.status(400).json({ message: 'Discount must be a non-negative number.' });
        return;
      }
      if (discount >= invoice.subtotal) {
        res.status(400).json({ message: 'Discount cannot equal or exceed the subtotal.' });
        return;
      }
      invoice.discount = discount;
      invoice.total = invoice.subtotal - discount;

      // Recalculate billClearDate after total changes
      const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount + (p.writeoff ?? 0), 0);
      if (totalPaid >= invoice.total) {
        invoice.billClearDate = invoice.payments[invoice.payments.length - 1]?.date ?? new Date();
      } else {
        invoice.billClearDate = undefined;
      }
    }

    await invoice.save();
    const populated = await populateInvoice(Invoice.findById(invoice._id));
    res.json(populated);
  } catch (error) {
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

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }

    // Apply discount to invoice (adds to existing invoice-level discount)
    const newDiscount = invoice.discount + discountAmount;
    if (amount + discountAmount <= 0) {
      res.status(400).json({ message: 'Amount and discount cannot both be zero.' });
      return;
    }
    if (discountAmount > 0 && newDiscount >= invoice.subtotal) {
      res.status(400).json({ message: 'Discount cannot equal or exceed the invoice subtotal.' });
      return;
    }
    const newTotal = invoice.subtotal - newDiscount;

    // Validate payment against remaining balance (use original total before applying new writeoff)
    const alreadyPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    const currentBalance = invoice.total - alreadyPaid;
    if (amount + discountAmount > currentBalance + 0.01) {
      res.status(400).json({ message: 'Payment and discount exceed the outstanding balance.' });
      return;
    }

    if (discountAmount > 0) {
      invoice.discount = newDiscount;
      invoice.total = newTotal;
    }

    const paymentDate = date ? new Date(date) : new Date();
    if (amount > 0) {
      invoice.payments.push({ date: paymentDate, amount, method });
    }

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount + (p.writeoff ?? 0), 0);
    if (totalPaid >= invoice.total) {
      invoice.billClearDate = paymentDate;
    } else {
      invoice.billClearDate = undefined;
    }

    await invoice.save();
    const populated = await populateInvoice(Invoice.findById(invoice._id));
    res.json(populated);
  } catch (error) {
    next(error);
  }
};

// ── UPDATE payment ───────────────────────────────────────────────────────────

export const updatePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const index = parseInt(String(req.params.paymentIndex), 10);
    const { amount, method } = req.body as { amount?: number; method?: 'cash' | 'online' };

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }
    if (isNaN(index) || index < 0 || index >= invoice.payments.length) {
      res.status(400).json({ message: 'Invalid payment index' });
      return;
    }

    if (amount !== undefined) {
      if (typeof amount !== 'number' || amount <= 0) {
        res.status(400).json({ message: 'amount must be a positive number.' });
        return;
      }
      invoice.payments[index].amount = amount;
    }
    if (method !== undefined) {
      if (!['cash', 'online'].includes(method)) {
        res.status(400).json({ message: "method must be 'cash' or 'online'." });
        return;
      }
      invoice.payments[index].method = method;
    }

    const totalSettled = invoice.payments.reduce((sum, p) => sum + p.amount + (p.writeoff ?? 0), 0);
    if (totalSettled > invoice.total + 0.01) {
      res.status(400).json({ message: 'Total payments exceed invoice total.' });
      return;
    }
    if (totalSettled >= invoice.total) {
      const last = invoice.payments[invoice.payments.length - 1];
      invoice.billClearDate = last?.date ?? new Date();
    } else {
      invoice.billClearDate = undefined;
    }

    await invoice.save();
    const populated = await populateInvoice(Invoice.findById(invoice._id));
    res.json(populated);
  } catch (error) {
    next(error);
  }
};

// ── DELETE payment ───────────────────────────────────────────────────────────

export const deletePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const index = parseInt(String(req.params.paymentIndex), 10);
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }
    if (isNaN(index) || index < 0 || index >= invoice.payments.length) {
      res.status(400).json({ message: 'Invalid payment index' });
      return;
    }

    invoice.payments.splice(index, 1);

    const totalSettled = invoice.payments.reduce((sum, p) => sum + p.amount + (p.writeoff ?? 0), 0);
    if (totalSettled >= invoice.total) {
      const last = invoice.payments[invoice.payments.length - 1];
      invoice.billClearDate = last?.date ?? new Date();
    } else {
      invoice.billClearDate = undefined;
    }

    await invoice.save();
    const populated = await populateInvoice(Invoice.findById(invoice._id));
    res.json(populated);
  } catch (error) {
    next(error);
  }
};

// ── DELETE invoice ───────────────────────────────────────────────────────────

export const deleteInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }
    await InvoiceItem.deleteMany({ _id: { $in: invoice.items } });
    res.json({ message: 'Invoice deleted' });
  } catch (error) {
    next(error);
  }
};

// ── ADD Item ─────────────────────────────────────────────────────────────────

export const addItemToInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = req.params.id;
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }

    const body = req.body as any;
    
    const refCount = [body.frame, body.opticalLens, body.fragrance].filter(Boolean).length;
    if (refCount !== 1) {
      res.status(400).json({ message: 'Each invoice item must reference exactly one of: frame, opticalLens, fragrance' });
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
    
    const doc: any = {
      quantity: body.quantity,
      price: body.price,
    };
    if (body.type === 'frame' && body.frame) doc.frame = body.frame;
    if (body.type === 'fragrance' && body.fragrance) doc.fragrance = body.fragrance;
    if (body.type === 'opticalLens') {
      doc.opticalLens = body.opticalLens;
      doc.prescription = body.prescription;
      doc.eye = body.eye;
      doc.userName = body.userName;
      doc.spherical = body.spherical;
      doc.cylinder = body.cylinder;
      doc.axis = body.axis;
      doc.addition = body.addition;
      doc.lensLabel = body.lensLabel;
      doc.lensBrand = body.lensBrand;
      doc.lensName = body.lensName;
      doc.lensCategory = body.lensCategory;
      doc.lensIndex = body.lensIndex;
      doc.lensCoating = body.lensCoating;
    }

    const invoiceItem = await InvoiceItem.create(doc);
    invoice.items.push(invoiceItem._id as mongoose.Types.ObjectId);
    
    // Recalc total
    const allItems = await InvoiceItem.find({ _id: { $in: invoice.items } });
    const subtotal = allItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const total = subtotal - invoice.discount;
    
    invoice.subtotal = subtotal;
    invoice.total = total;
    
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount + (p.writeoff ?? 0), 0);
    if (totalPaid >= total) {
      invoice.billClearDate = new Date();
    } else {
      invoice.billClearDate = undefined;
    }
    
    await invoice.save();

    const populated = await populateInvoice(Invoice.findById(invoice._id));
    res.json(populated);
  } catch (error) {
    next(error);
  }
};

// ── REMOVE Item ──────────────────────────────────────────────────────────────

export const removeItemFromInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const itemIndex = req.params.itemIndex as string;
    const index = parseInt(itemIndex, 10);
    
    const invoice = await Invoice.findById(id);
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }
    
    if (invoice.items.length <= 1) {
      res.status(400).json({ message: 'Invoice must have at least one item' });
      return;
    }
    
    if (index < 0 || index >= invoice.items.length) {
      res.status(400).json({ message: 'Invalid item index' });
      return;
    }
    
    const itemToRemoveId = invoice.items[index];
    invoice.items.splice(index, 1);
    
    await InvoiceItem.findByIdAndDelete(itemToRemoveId);
    
    // Recalc total
    const allItems = await InvoiceItem.find({ _id: { $in: invoice.items } });
    const subtotal = allItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const total = subtotal - invoice.discount;
    
    invoice.subtotal = subtotal;
    invoice.total = total;
    
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount + (p.writeoff ?? 0), 0);
    if (totalPaid >= total) {
      invoice.billClearDate = new Date();
    } else {
      invoice.billClearDate = undefined;
    }
    
    await invoice.save();
    
    const populated = await populateInvoice(Invoice.findById(invoice._id));
    res.json(populated);
  } catch (error) {
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

export const updateItemInInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, itemId } = req.params;
    const { quantity, price } = req.body;
    
    if (typeof quantity !== 'number' || quantity <= 0) {
      res.status(400).json({ message: 'Quantity must be a positive number.' });
      return;
    }
    if (typeof price !== 'number' || price < 0) {
      res.status(400).json({ message: 'Price must be a non-negative number.' });
      return;
    }
    
    const invoice = await Invoice.findById(id);
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }
    
    if (!invoice.items.includes(itemId as any)) {
      res.status(400).json({ message: 'Item does not belong to this invoice' });
      return;
    }
    
    await InvoiceItem.findByIdAndUpdate(itemId, { quantity, price });
    
    // Recalc total
    const allItems = await InvoiceItem.find({ _id: { $in: invoice.items } });
    const subtotal = allItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const total = subtotal - invoice.discount;
    
    invoice.subtotal = subtotal;
    invoice.total = total;
    
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount + (p.writeoff ?? 0), 0);
    if (totalPaid >= total) {
      invoice.billClearDate = new Date();
    } else {
      invoice.billClearDate = undefined;
    }
    
    await invoice.save();
    
    const populated = await populateInvoice(Invoice.findById(invoice._id));
    res.json(populated);
  } catch (error) {
    next(error);
  }
};
