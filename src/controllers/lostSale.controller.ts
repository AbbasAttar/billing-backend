import { Request, Response, NextFunction } from 'express';
import { LostSale } from '../models/LostSale.model';

// ── POST /api/lost-sales ─────────────────────────────────────────────────────
export const createLostSale = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lostSale = new LostSale(req.body);
    const saved = await lostSale.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

// ── GET /api/lost-sales ──────────────────────────────────────────────────────
export const getLostSales = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, category } = req.query;

    const filter: Record<string, any> = {};
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from as string);
      if (to) filter.date.$lte = new Date(to as string);
    }
    if (category) filter.category = category;

    const lostSales = await LostSale.find(filter)
      .populate('customer', 'name mobileNumber')
      .sort({ date: -1 })
      .lean();

    const totalEstimatedLoss = lostSales.reduce(
      (sum, ls) => sum + ls.estimatedPrice * ls.qty,
      0
    );

    res.json({
      count: lostSales.length,
      totalEstimatedLoss: Math.round(totalEstimatedLoss),
      lostSales,
    });
  } catch (error) {
    next(error);
  }
};
