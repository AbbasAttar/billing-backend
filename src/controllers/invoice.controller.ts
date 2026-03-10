import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { OpticalNumber } from '../models/OpticalNumber.model';
import { Customer } from '../models/Customer.model';
import type { CreateInvoiceInput, CreateInvoiceItemInput, InlineOpticalNumberInput } from '../types';

// ── Populate helper ──────────────────────────────────────────────────────────

const populateInvoice = (query: any) =>
  query
    .populate('customer')
    .populate({
      path: 'items',
      populate: [
        { path: 'frame' },
        { path: 'opticalLens' },
        { path: 'fragrance' },
      ],
    });

// ── Validation ───────────────────────────────────────────────────────────────

const validateAxis = (val?: number): boolean =>
  val === undefined || (val >= 0 && val <= 180);

function validateItems(items: CreateInvoiceItemInput[]): string | null {
  for (const [i, item] of items.entries()) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      return `Item ${i + 1}: quantity must be a positive integer.`;
    }
    if (typeof item.price !== 'number' || item.price < 0) {
      return `Item ${i + 1}: price must be a non-negative number.`;
    }
    if (item.type === 'opticalLens') {
      const hasRef = !!item.opticalLens;
      const hasInline = !!item.inlineOpticalNumber;
      if (!hasRef && !hasInline) {
        return `Item ${i + 1}: optical lens item must provide either opticalLens (id) or inlineOpticalNumber.`;
      }
      if (hasRef && hasInline) {
        return `Item ${i + 1}: provide either opticalLens or inlineOpticalNumber, not both.`;
      }
      if (hasInline) {
        const rx = item.inlineOpticalNumber!;
        if (!rx.name?.trim()) {
          return `Item ${i + 1}: inlineOpticalNumber.name is required.`;
        }
        const axisFields: (keyof InlineOpticalNumberInput)[] = ['leftAxis', 'rightAxis'];
        for (const field of axisFields) {
          const val = rx[field] as number | undefined;
          if (!validateAxis(val)) {
            return `Item ${i + 1}: ${field} must be between 0 and 180.`;
          }
        }
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
  let createdCustomerId: mongoose.Types.ObjectId | null = null;

  try {
    const body: CreateInvoiceInput = req.body;
    const { customer: customerIdRaw, customerName, customerMobile, customerAddress, items } = body;

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

    // ── 2. Resolve customer ──────────────────────────────────────────────────
    let customerId: mongoose.Types.ObjectId;

    if (customerIdRaw && mongoose.isValidObjectId(customerIdRaw)) {
      // Use existing customer
      const existing = await Customer.findById(customerIdRaw);
      if (!existing) {
        res.status(404).json({ message: 'Customer not found.' });
        return;
      }
      customerId = existing._id as mongoose.Types.ObjectId;
    } else {
      // Create new customer
      if (!customerName?.trim() || !customerMobile?.trim()) {
        res.status(400).json({ message: 'customerName and customerMobile are required when creating a new customer.' });
        return;
      }
      const newCustomer = await Customer.create({
        name: customerName.trim(),
        mobileNumber: customerMobile.trim(),
        address: customerAddress?.trim() || undefined,
      });
      customerId = newCustomer._id as mongoose.Types.ObjectId;
      createdCustomerId = customerId;
    }

    // ── 3. Create inline OpticalNumbers ─────────────────────────────────────
    const resolvedItems: Array<CreateInvoiceItemInput & { _resolvedOpticalLens?: mongoose.Types.ObjectId }> = [];

    for (const item of items) {
      if (item.type === 'opticalLens' && item.inlineOpticalNumber && !item.opticalLens) {
        const rx = item.inlineOpticalNumber;
        const newOptical = await OpticalNumber.create({
          customer: customerId,
          name: rx.name.trim(),
          lensType: rx.lensType || undefined,
          leftSpherical: rx.leftSpherical,
          leftCylinder: rx.leftCylinder,
          leftAddition: rx.leftAddition,
          leftAxis: rx.leftAxis,
          rightSpherical: rx.rightSpherical,
          rightCylinder: rx.rightCylinder,
          rightAddition: rx.rightAddition,
          rightAxis: rx.rightAxis,
        });
        createdOpticalNumberIds.push(newOptical._id as mongoose.Types.ObjectId);
        resolvedItems.push({ ...item, _resolvedOpticalLens: newOptical._id as mongoose.Types.ObjectId });
      } else {
        resolvedItems.push({ ...item });
      }
    }

    // ── 4. Create InvoiceItems ───────────────────────────────────────────────
    const invoiceItemIds: mongoose.Types.ObjectId[] = [];

    for (const item of resolvedItems) {
      const doc: Record<string, any> = {
        quantity: item.quantity,
        price: item.price,
      };
      if (item.type === 'frame' && item.frame) doc.frame = item.frame;
      if (item.type === 'fragrance' && item.fragrance) doc.fragrance = item.fragrance;
      if (item.type === 'opticalLens') {
        doc.opticalLens = item._resolvedOpticalLens ?? item.opticalLens;
      }

      const invoiceItem = await InvoiceItem.create(doc);
      createdInvoiceItemIds.push(invoiceItem._id as mongoose.Types.ObjectId);
      invoiceItemIds.push(invoiceItem._id as mongoose.Types.ObjectId);
    }

    // ── 5. Calculate total ───────────────────────────────────────────────────
    const total = resolvedItems.reduce((sum, i) => sum + i.quantity * i.price, 0);

    // ── 6. Resolve initialPayment ─────────────────────────────────────────────
    const { initialPayment } = body;
    const initialPayments: Array<{ date: Date; amount: number }> = [];
    let billClearDate: Date | undefined;

    if (initialPayment !== undefined && initialPayment !== 0) {
      if (typeof initialPayment !== 'number' || initialPayment <= 0) {
        res.status(400).json({ message: 'initialPayment must be a positive number.' });
        return;
      }
      if (initialPayment > total) {
        res.status(400).json({ message: 'Initial payment cannot exceed invoice total.' });
        return;
      }
      initialPayments.push({ date: new Date(), amount: initialPayment });
      if (initialPayment === total) {
        billClearDate = new Date();
      }
    }

    // ── 7. Create Invoice ────────────────────────────────────────────────────
    const invoice = await Invoice.create({
      customer: customerId,
      items: invoiceItemIds,
      total,
      billDate: new Date(),
      payments: initialPayments,
      ...(billClearDate ? { billClearDate } : {}),
    });

    const populated = await populateInvoice(Invoice.findById(invoice._id));
    res.status(201).json(populated);
  } catch (error) {
    // ── Rollback ─────────────────────────────────────────────────────────────
    if (createdInvoiceItemIds.length > 0) {
      await InvoiceItem.deleteMany({ _id: { $in: createdInvoiceItemIds } }).catch(() => {});
    }
    if (createdOpticalNumberIds.length > 0) {
      await OpticalNumber.deleteMany({ _id: { $in: createdOpticalNumberIds } }).catch(() => {});
    }
    // Note: we do NOT delete createdCustomerId — a customer may have been legitimately kept
    next(error);
  }
};

// ── UPDATE invoice ───────────────────────────────────────────────────────────

export const updateInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }
    res.json(invoice);
  } catch (error) {
    next(error);
  }
};

// ── ADD payment ──────────────────────────────────────────────────────────────

export const addPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, date } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ message: 'amount must be a positive number.' });
      return;
    }

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      res.status(404).json({ message: 'Invoice not found' });
      return;
    }

    const paymentDate = date ? new Date(date) : new Date();
    invoice.payments.push({ date: paymentDate, amount });

    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    if (totalPaid >= invoice.total) {
      invoice.billClearDate = new Date();
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
