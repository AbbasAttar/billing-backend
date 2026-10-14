import { Request, Response, NextFunction } from 'express';
import { Invoice } from '../models/Invoice.model';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { LensStock } from '../models/LensStock.model';
import { WholesaleItem } from '../models/WholesaleItem.model';
import { buildFragranceInsights, buildOpticsInsights } from '../services/categoryInsights';

const ALLOWED_DAYS = [30, 90, 180, 365];

function windowFor(req: Request) {
  const asked = Number(req.query.days);
  const days = ALLOWED_DAYS.includes(asked) ? asked : 90;
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);
  return { days, now, from };
}

const periodInvoices = (from: Date, to: Date) =>
  Invoice.find({ billDate: { $gte: from, $lte: to } }).select({ billDate: 1, items: 1 }).populate('items').lean();

/** GET /analytics/insights/optics?days=30|90|180|365 — frames and lenses: sales, stock and guidance. */
export const getOpticsInsights = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days, now, from } = windowFor(req);
    const [invoices, frames, lensStock] = await Promise.all([
      periodInvoices(from, now),
      Frame.find({}).select('name companyName costPrice sellPrice stock createdAt isArchived').lean(),
      LensStock.find({}).select('lensType coating sph cyl add quantity reorderLevel').lean(),
    ]);
    res.json({ from: from.toISOString(), to: now.toISOString(), ...buildOpticsInsights({ invoices: invoices as any, frames: frames as any, lensStock: lensStock as any, days, now }) });
  } catch (e) {
    next(e);
  }
};

/** GET /analytics/insights/fragrance?days=… — retail fragrances and wholesale stock: sales, stock and guidance. */
export const getFragranceInsights = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days, now, from } = windowFor(req);
    const [invoices, fragrances, wholesale] = await Promise.all([
      periodInvoices(from, now),
      Fragrance.find({}).select('name companyName type costPrice stock variants isArchived').lean(),
      WholesaleItem.find({}).select('name companyName unit costPrice stock reorderLevel isOrdered orderedQty orderedAt isArchived').lean(),
    ]);
    res.json({ from: from.toISOString(), to: now.toISOString(), ...buildFragranceInsights({ invoices: invoices as any, fragrances: fragrances as any, wholesale: wholesale as any, days, now }) });
  } catch (e) {
    next(e);
  }
};
