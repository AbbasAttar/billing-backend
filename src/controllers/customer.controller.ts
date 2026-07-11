import { Request, Response, NextFunction } from 'express';
import { Customer } from '../models/Customer.model';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';

export const getAllCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 0;
    const limit = parseInt(req.query.limit as string) || 0;
    let query = Customer.find().sort({ name: 1 });
    if (page > 0 && limit > 0) {
      query = query.skip((page - 1) * limit).limit(limit) as typeof query;
    }
    const customers = await query;
    res.json(customers);
  } catch (error) {
    next(error);
  }
};

export const searchCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const customers = await Customer.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { mobileNumber: { $regex: q, $options: 'i' } },
      ],
    }).limit(10);
    res.json(customers);
  } catch (error) {
    next(error);
  }
};

export const getCustomerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }
    res.json(customer);
  } catch (error) {
    next(error);
  }
};

export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = new Customer(req.body);
    const saved = await customer.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }
    res.json(customer);
  } catch (error) {
    next(error);
  }
};

export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceCount = await Invoice.countDocuments({ customer: req.params.id });
    if (invoiceCount > 0) {
      res.status(409).json({ message: 'Customer has existing invoices and cannot be deleted.' });
      return;
    }
    const customer = await Customer.findByIdAndDelete(req.params.id);
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }
    res.json({ message: 'Customer deleted' });
  } catch (error) {
    next(error);
  }
};

// ── GET /api/customers/:id/summary ───────────────────────────────────────────
export const getCustomerSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      res.status(404).json({ message: 'Customer not found' });
      return;
    }

    const invoices = await Invoice.find({ customer: req.params.id })
      .populate('items')
      .sort({ billDate: 1 })
      .lean();

    if (invoices.length === 0) {
      res.json({
        customerId: customer._id,
        name: customer.name,
        lifetimeValue: 0,
        invoiceCount: 0,
        avgBill: 0,
        lastVisit: null,
        lastVisitDaysAgo: null,
        pendingBalance: 0,
        favoriteCategory: null,
        purchaseFrequencyDays: null,
        categories: [],
        nextRecommendations: [],
      });
      return;
    }

    // Core financials
    const lifetimeValue = invoices.reduce((s, inv) => s + inv.total, 0);
    const avgBill = lifetimeValue / invoices.length;
    const lastInvoice = invoices[invoices.length - 1];
    const lastVisit = lastInvoice.billDate;
    const lastVisitDaysAgo = Math.floor((Date.now() - new Date(lastVisit).getTime()) / 86_400_000);

    // Pending balance
    const pendingBalance = invoices.reduce((s, inv) => {
      const paid = inv.payments.reduce((ps: number, p: any) => ps + p.amount + (p.writeoff ?? 0), 0);
      return s + Math.max(0, inv.total - paid);
    }, 0);

    // Category breakdown across all items
    const categoryCounts: Record<string, number> = { frame: 0, opticalLens: 0, fragrance: 0 };
    let hasBlueCut = false;

    for (const inv of invoices) {
      for (const item of (inv.items as any[])) {
        if (item.frame) categoryCounts.frame++;
        else if (item.opticalLens || item.lensName || item.lensBrand) {
          categoryCounts.opticalLens++;
          const coating = (item.lensCoating ?? '').toLowerCase();
          const name = (item.lensName ?? '').toLowerCase();
          const label = (item.lensLabel ?? '').toLowerCase();
          if (coating.includes('blue') || name.includes('blue') || label.includes('blue')) {
            hasBlueCut = true;
          }
        } else if (item.fragrance) categoryCounts.fragrance++;
      }
    }

    const favoriteCategory = Object.entries(categoryCounts)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

    // Purchase frequency (avg days between invoices)
    let purchaseFrequencyDays: number | null = null;
    if (invoices.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < invoices.length; i++) {
        const gap = (new Date(invoices[i].billDate).getTime() - new Date(invoices[i - 1].billDate).getTime()) / 86_400_000;
        gaps.push(gap);
      }
      purchaseFrequencyDays = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
    }

    // Next recommendations (simple rule-based)
    const recommendations: { product: string; reason: string }[] = [];
    const hasOptical = categoryCounts.opticalLens > 0 || categoryCounts.frame > 0;
    const hasFragrance = categoryCounts.fragrance > 0;

    if (hasOptical && !hasBlueCut) {
      recommendations.push({ product: 'Blue Cut Lenses', reason: 'Has optical purchases but no blue-cut coating detected' });
    }
    if (hasOptical && lastVisitDaysAgo >= 540) {
      recommendations.push({ product: 'Eye Test + New Lenses', reason: 'Last optical visit was 18+ months ago — prescription may need updating' });
    }
    if (hasOptical && !hasFragrance) {
      recommendations.push({ product: 'Premium Fragrance', reason: 'Optical customer who has never tried the fragrance collection' });
    }
    if (hasFragrance && !hasOptical) {
      recommendations.push({ product: 'Spectacles / Frame', reason: 'Fragrance buyer who has never bought optical products' });
    }

    res.json({
      customerId: customer._id,
      name: customer.name,
      lifetimeValue: Math.round(lifetimeValue),
      invoiceCount: invoices.length,
      avgBill: Math.round(avgBill),
      lastVisit,
      lastVisitDaysAgo,
      pendingBalance: Math.round(pendingBalance),
      favoriteCategory,
      purchaseFrequencyDays,
      hasBlueCut,
      categories: Object.entries(categoryCounts).filter(([, c]) => c > 0).map(([cat]) => cat),
      nextRecommendations: recommendations.slice(0, 3),
    });
  } catch (error) {
    next(error);
  }
};
