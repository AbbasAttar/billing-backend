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
      invoiceMatch.customer = customerId;
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

// ── FRAGRANCE TRENDS ─────────────────────────────────────────────────────────

export const getFragranceTrends = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Top sold fragrances
    const topSoldRaw = await InvoiceItem.aggregate([
      { $match: { fragrance: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$fragrance',
          count: { $sum: '$quantity' },
          totalRevenue: { $sum: { $multiply: ['$quantity', '$price'] } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 25 },
      {
        $lookup: {
          from: 'fragrances',
          localField: '_id',
          foreignField: '_id',
          as: 'fragranceDoc',
        },
      },
      { $unwind: '$fragranceDoc' },
      {
        $project: {
          _id: 1,
          companyName: '$fragranceDoc.companyName',
          name: '$fragranceDoc.name',
          type: { $ifNull: ['$fragranceDoc.type', 'attar'] },
          authenticity: { $ifNull: ['$fragranceDoc.authenticity', 'original'] },
          currentStock: {
            $cond: {
              if: { $gt: [{ $size: { $ifNull: ['$fragranceDoc.variants', []] } }, 0] },
              then: { $sum: '$fragranceDoc.variants.stock' },
              else: { $ifNull: ['$fragranceDoc.stock', 0] },
            },
          },
          count: 1,
          totalRevenue: { $round: ['$totalRevenue', 0] },
        },
      },
    ]);

    // 2. Low stock fragrances (total stock <= 2 or any variant stock <= 1)
    const allActive = await Fragrance.find({ isArchived: { $ne: true } })
      .sort({ companyName: 1, name: 1 })
      .lean();

    const lowStock = allActive
      .filter((f) => {
        if (f.variants && f.variants.length > 0) {
          const totalStock = f.variants.reduce((s, v) => s + (v.stock || 0), 0);
          const hasLowVariant = f.variants.some((v) => (v.stock || 0) <= 1);
          return totalStock <= 2 || hasLowVariant;
        }
        return (f.stock ?? 0) <= 2;
      })
      .slice(0, 50);

    // 3. Type distribution
    const typeDistRaw = await InvoiceItem.aggregate([
      { $match: { fragrance: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'fragrances',
          localField: 'fragrance',
          foreignField: '_id',
          as: 'fragranceDoc',
        },
      },
      { $unwind: '$fragranceDoc' },
      {
        $group: {
          _id: { $ifNull: ['$fragranceDoc.type', 'attar'] },
          count: { $sum: '$quantity' },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const typeDistribution = typeDistRaw.map((d) => ({
      type: d._id,
      count: d.count,
    }));

    // 4. Authenticity distribution
    const authDistRaw = await InvoiceItem.aggregate([
      { $match: { fragrance: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'fragrances',
          localField: 'fragrance',
          foreignField: '_id',
          as: 'fragranceDoc',
        },
      },
      { $unwind: '$fragranceDoc' },
      {
        $group: {
          _id: { $ifNull: ['$fragranceDoc.authenticity', 'original'] },
          count: { $sum: '$quantity' },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const authenticityDistribution = authDistRaw.map((d) => ({
      authenticity: d._id,
      count: d.count,
    }));

    // 5. Restock suggestions: top sold fragrances that are low/out of stock
    const restockSuggestions = topSoldRaw
      .filter((f) => f.currentStock <= 2)
      .map((f) => ({
        ...f,
        reorderLevel: 2,
        needsRestock: true,
      }));

    res.json({
      topSold: topSoldRaw,
      lowStock,
      typeDistribution,
      authenticityDistribution,
      restockSuggestions,
    });
  } catch (error) {
    next(error);
  }
};

// ── FRAGRANCE SOLD HISTORY ───────────────────────────────────────────────────

export const getFragranceSold = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 90, 730);
    const from = new Date();
    from.setDate(from.getDate() - days);

    const records = await InvoiceItem.aggregate([
      {
        $match: {
          fragrance: { $exists: true, $ne: null },
          createdAt: { $gte: from },
        },
      },
      {
        $lookup: {
          from: 'fragrances',
          localField: 'fragrance',
          foreignField: '_id',
          as: 'fragranceDoc',
        },
      },
      { $unwind: '$fragranceDoc' },
      {
        $group: {
          _id: '$fragrance',
          companyName: { $first: '$fragranceDoc.companyName' },
          name: { $first: '$fragranceDoc.name' },
          type: { $first: { $ifNull: ['$fragranceDoc.type', 'attar'] } },
          authenticity: { $first: { $ifNull: ['$fragranceDoc.authenticity', 'original'] } },
          currentStock: {
            $first: {
              $cond: {
                if: { $gt: [{ $size: { $ifNull: ['$fragranceDoc.variants', []] } }, 0] },
                then: { $sum: '$fragranceDoc.variants.stock' },
                else: { $ifNull: ['$fragranceDoc.stock', 0] },
              },
            },
          },
          timesSold: { $sum: '$quantity' },
          avgPrice: { $avg: '$price' },
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' },
          totalRevenue: { $sum: { $multiply: ['$price', '$quantity'] } },
        },
      },
      { $sort: { timesSold: -1 } },
      { $limit: 500 },
      {
        $project: {
          _id: 1,
          fragranceId: '$_id',
          companyName: 1,
          name: 1,
          type: 1,
          authenticity: 1,
          currentStock: 1,
          timesSold: 1,
          avgPrice: { $round: ['$avgPrice', 0] },
          minPrice: 1,
          maxPrice: 1,
          totalRevenue: { $round: ['$totalRevenue', 0] },
        },
      },
    ]);

    res.json({ days, from, records });
  } catch (error) {
    next(error);
  }
};

