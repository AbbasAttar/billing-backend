import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Fragrance } from '../models/Fragrance.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Invoice } from '../models/Invoice.model';

export const getFragranceRevenueSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, customerId } = req.query as Record<string, string | undefined>;

    const invoiceMatch: Record<string, unknown> = {};
    if (from || to) {
      invoiceMatch.billDate = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to   ? { $lte: new Date(new Date(to).setHours(23, 59, 59, 999)) } : {}),
      };
    }
    if (customerId) {
      invoiceMatch.customer = new mongoose.Types.ObjectId(customerId);
    }

    const rows = await Invoice.aggregate([
      { $match: invoiceMatch },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'invoiceitems',
          localField: 'items',
          foreignField: '_id',
          as: 'item',
        },
      },
      { $unwind: '$item' },
      { $match: { 'item.fragrance': { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$item.fragrance',
          totalRevenue: { $sum: { $multiply: ['$item.price', '$item.quantity'] } },
          unitsSold: { $sum: '$item.quantity' },
          invoiceCount: { $sum: 1 },
        },
      },
    ]);

    const map: Record<string, { totalRevenue: number; unitsSold: number; invoiceCount: number }> = {};
    for (const r of rows) {
      map[r._id.toString()] = { totalRevenue: r.totalRevenue, unitsSold: r.unitsSold, invoiceCount: r.invoiceCount };
    }
    res.json(map);
  } catch (error) {
    next(error);
  }
};

export const getAllFragrances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const archivedOnly = req.query.archived === '1';
    const baseFilter = archivedOnly ? { isArchived: true } : { isArchived: { $ne: true } };
    const textFilter = q
      ? { $or: [{ name: { $regex: q, $options: 'i' } }, { companyName: { $regex: q, $options: 'i' } }] }
      : {};
    const fragrances = await Fragrance.find({ ...baseFilter, ...textFilter }).sort({ companyName: 1, name: 1 });
    res.json(fragrances);
  } catch (error) {
    next(error);
  }
};

export const searchFragrances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const fragrances = await Fragrance.find({
      isArchived: { $ne: true },
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { companyName: { $regex: q, $options: 'i' } },
      ],
    }).limit(15);
    res.json(fragrances);
  } catch (error) {
    next(error);
  }
};

export const getFragranceById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fragrance = await Fragrance.findById(req.params.id);
    if (!fragrance) {
      res.status(404).json({ message: 'Fragrance not found' });
      return;
    }
    res.json(fragrance);
  } catch (error) {
    next(error);
  }
};

export const createFragrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fragrance = new Fragrance(req.body);
    const saved = await fragrance.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const updateFragrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fragrance = await Fragrance.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!fragrance) {
      res.status(404).json({ message: 'Fragrance not found' });
      return;
    }
    res.json(fragrance);
  } catch (error) {
    next(error);
  }
};

export const archiveFragrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fragrance = await Fragrance.findById(req.params.id);
    if (!fragrance) {
      res.status(404).json({ message: 'Fragrance not found' });
      return;
    }
    const nowArchived = !fragrance.isArchived;
    fragrance.isArchived = nowArchived;
    fragrance.archivedAt = nowArchived ? new Date() : undefined;
    if (nowArchived && fragrance.web) {
      fragrance.web.isPublished = false;
    }
    await fragrance.save();
    res.json(fragrance);
  } catch (error) {
    next(error);
  }
};

export const deleteFragrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const usageCount = await InvoiceItem.countDocuments({ fragrance: req.params.id });
    if (usageCount > 0) {
      res.status(409).json({ message: 'Fragrance is used in existing invoices and cannot be deleted.' });
      return;
    }
    const fragrance = await Fragrance.findByIdAndDelete(req.params.id);
    if (!fragrance) {
      res.status(404).json({ message: 'Fragrance not found' });
      return;
    }
    res.json({ message: 'Fragrance deleted' });
  } catch (error) {
    next(error);
  }
};
