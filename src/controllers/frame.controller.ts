import { Request, Response, NextFunction } from 'express';
import { Frame } from '../models/Frame.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { calculateDefaultFramePricing } from '../utils/pricing.utils';

function buildFrameQuery(q: string) {
  if (!q) return {};
  // Exact 10-16 digit code → search by frameCode first
  if (/^\d{10,16}$/.test(q)) {
    return { $or: [{ frameCode: q }, { name: { $regex: q, $options: 'i' } }] };
  }
  return { $or: [
    { name: { $regex: q, $options: 'i' } },
    { companyName: { $regex: q, $options: 'i' } },
    { frameCode: { $regex: q, $options: 'i' } },
    { houseName: { $regex: q, $options: 'i' } },
  ]};
}

export const getAllFrames = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const archivedOnly = req.query.archived === '1';
    const baseFilter = archivedOnly ? { isArchived: true } : { isArchived: { $ne: true } };
    const query = q ? { ...baseFilter, ...buildFrameQuery(q) } : baseFilter;
    const frames = await Frame.find(query).sort({ companyName: 1, name: 1 });
    res.json(frames);
  } catch (error) {
    next(error);
  }
};

export const searchFrames = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const frames = await Frame.find({ isArchived: { $ne: true }, ...buildFrameQuery(q) }).limit(15);
    res.json(frames);
  } catch (error) {
    next(error);
  }
};

export const getFrameById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const frame = await Frame.findById(req.params.id);
    if (!frame) {
      res.status(404).json({ message: 'Frame not found' });
      return;
    }
    res.json(frame);
  } catch (error) {
    next(error);
  }
};

export const createFrame = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const frame = new Frame(req.body);
    const saved = await frame.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const updateFrame = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updateData = { ...req.body };
    const costPrice = Number(updateData.costPrice);
    if (costPrice && costPrice > 0) {
      const defaults = calculateDefaultFramePricing(costPrice, updateData.mrp || updateData.sellPrice);
      if (!updateData.tier) updateData.tier = defaults.tier;
      if (updateData.storePrice === undefined || updateData.storePrice === null || updateData.storePrice === 0) {
        updateData.storePrice = defaults.storePrice;
      }
      if (updateData.floorPrice === undefined || updateData.floorPrice === null || updateData.floorPrice === 0) {
        updateData.floorPrice = defaults.floorPrice;
      }
    }

    const frame = await Frame.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });
    if (!frame) {
      res.status(404).json({ message: 'Frame not found' });
      return;
    }
    res.json(frame);
  } catch (error) {
    next(error);
  }
};

export const archiveFrame = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const frame = await Frame.findById(req.params.id);
    if (!frame) {
      res.status(404).json({ message: 'Frame not found' });
      return;
    }
    const nowArchived = !frame.isArchived;
    frame.isArchived = nowArchived;
    frame.archivedAt = nowArchived ? new Date() : undefined;
    // Unpublish from website when archiving
    if (nowArchived && frame.web) {
      frame.web.isPublished = false;
    }
    await frame.save();
    res.json(frame);
  } catch (error) {
    next(error);
  }
};

export const deleteFrame = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const usageCount = await InvoiceItem.countDocuments({ frame: req.params.id });
    if (usageCount > 0) {
      res.status(409).json({ message: 'Frame is used in existing invoices and cannot be deleted.' });
      return;
    }
    const frame = await Frame.findByIdAndDelete(req.params.id);
    if (!frame) {
      res.status(404).json({ message: 'Frame not found' });
      return;
    }
    res.json({ message: 'Frame deleted' });
  } catch (error) {
    next(error);
  }
};

// ── FRAME TRENDS ─────────────────────────────────────────────────────────────

export const getFrameTrends = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. Top sold frames
    const topSoldRaw = await InvoiceItem.aggregate([
      { $match: { frame: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$frame',
          count: { $sum: '$quantity' },
          totalRevenue: { $sum: { $multiply: ['$quantity', '$price'] } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 25 },
      {
        $lookup: {
          from: 'frames',
          localField: '_id',
          foreignField: '_id',
          as: 'frameDoc',
        },
      },
      { $unwind: '$frameDoc' },
      {
        $project: {
          _id: 1,
          companyName: '$frameDoc.companyName',
          name: '$frameDoc.name',
          type: { $ifNull: ['$frameDoc.type', 'Full Rim'] },
          shape: { $ifNull: ['$frameDoc.web.shape', '—'] },
          tier: '$frameDoc.tier',
          currentStock: { $ifNull: ['$frameDoc.stock', 0] },
          count: 1,
          totalRevenue: { $round: ['$totalRevenue', 0] },
        },
      },
    ]);

    // 2. Low stock frames (stock <= 2, active)
    const lowStock = await Frame.find({
      isArchived: { $ne: true },
      stock: { $lte: 2 },
    })
      .sort({ stock: 1, companyName: 1 })
      .limit(50)
      .lean();

    // 3. Shape & Type distribution from sold frames
    const shapeDistRaw = await InvoiceItem.aggregate([
      { $match: { frame: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'frames',
          localField: 'frame',
          foreignField: '_id',
          as: 'frameDoc',
        },
      },
      { $unwind: '$frameDoc' },
      {
        $group: {
          _id: { $ifNull: ['$frameDoc.web.shape', 'Classic / Standard'] },
          count: { $sum: '$quantity' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    const shapeDistribution = shapeDistRaw.map((d) => ({
      shape: d._id || 'Classic',
      count: d.count,
    }));

    const typeDistRaw = await InvoiceItem.aggregate([
      { $match: { frame: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'frames',
          localField: 'frame',
          foreignField: '_id',
          as: 'frameDoc',
        },
      },
      { $unwind: '$frameDoc' },
      {
        $group: {
          _id: { $ifNull: ['$frameDoc.type', 'Full Rim'] },
          count: { $sum: '$quantity' },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const typeDistribution = typeDistRaw.map((d) => ({
      type: d._id || 'Full Rim',
      count: d.count,
    }));

    // 4. Restock suggestions: top sold frames that are low/out of stock
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
      shapeDistribution,
      typeDistribution,
      restockSuggestions,
    });
  } catch (error) {
    next(error);
  }
};

// ── FRAME SOLD HISTORY ────────────────────────────────────────────────────────

export const getFrameSold = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 90, 730);
    const from = new Date();
    from.setDate(from.getDate() - days);

    const records = await InvoiceItem.aggregate([
      {
        $match: {
          frame: { $exists: true, $ne: null },
          createdAt: { $gte: from },
        },
      },
      {
        $lookup: {
          from: 'frames',
          localField: 'frame',
          foreignField: '_id',
          as: 'frameDoc',
        },
      },
      { $unwind: '$frameDoc' },
      {
        $group: {
          _id: '$frame',
          companyName: { $first: '$frameDoc.companyName' },
          name: { $first: '$frameDoc.name' },
          type: { $first: { $ifNull: ['$frameDoc.type', 'Full Rim'] } },
          shape: { $first: { $ifNull: ['$frameDoc.web.shape', '—'] } },
          tier: { $first: '$frameDoc.tier' },
          currentStock: { $first: { $ifNull: ['$frameDoc.stock', 0] } },
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
          frameId: '$_id',
          companyName: 1,
          name: 1,
          type: 1,
          shape: 1,
          tier: 1,
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

