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
      if (item.eye !== 'left' && item.eye !== 'right') {
        return `Item ${i + 1}: optical lens item must declare eye as 'left' or 'right'.`;
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
      initialPayments.push({ date: billDate, amount: initialPayment });
      if (initialPayment === total) {
        billClearDate = billDate;
      }
    }

    // ── 9. Create Invoice ────────────────────────────────────────────────────
    const invoice = await Invoice.create({
      customer: customerId,
      items: invoiceItemIds,
      subtotal,
      discount,
      total,
      billDate,
      payments: initialPayments,
      ...(billClearDate ? { billClearDate } : {}),
    });

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
