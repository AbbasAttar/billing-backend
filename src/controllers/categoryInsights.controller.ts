import { Request, Response, NextFunction } from 'express';
import { Invoice } from '../models/Invoice.model';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { LensStock } from '../models/LensStock.model';
import { WholesaleItem } from '../models/WholesaleItem.model';
import { buildFragranceInsights } from '../services/categoryInsights';
import { wholesaleEntries } from '../services/wholesaleCatalog';
import { buildOpticsInsights } from '../services/opticsInsights';

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

/** GET /analytics/insights/optics?days=30|90|180|365 — frames and lenses, compared with the previous period. */
export const getOpticsInsights = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days, now, from } = windowFor(req);
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(from);
    prevFrom.setDate(prevFrom.getDate() - days);
    const [invoices, previousInvoices, frames, lensStock] = await Promise.all([
      periodInvoices(from, now),
      periodInvoices(prevFrom, prevTo),
      Frame.find({}).select('name companyName type costPrice sellPrice stock createdAt isArchived').lean(),
      LensStock.find({}).select('lensType material coating color sph cyl add quantity').lean(),
    ]);
    res.json({
      from: from.toISOString(), to: now.toISOString(),
      ...buildOpticsInsights({ invoices: invoices as any, previousInvoices: previousInvoices as any, frames: frames as any, lensStock: lensStock as any, days, now }),
    });
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
      Fragrance.find({}).lean(),
      WholesaleItem.find({}).select('name companyName unit costPrice stock reorderLevel isOrdered orderedQty orderedAt isArchived migratedTo').lean(),
    ]);
    // Wholesale stock now lives on fragrance records; old items that were not moved still count.
    const entries = wholesaleEntries((fragrances as any[]).filter((f) => !f.isArchived)).map((e) => ({ ...e, _id: e._id }));
    const unmoved = (wholesale as any[]).filter((w) => !w.migratedTo);
    res.json({ from: from.toISOString(), to: now.toISOString(), ...buildFragranceInsights({ invoices: invoices as any, fragrances: fragrances as any, wholesale: [...entries, ...unmoved] as any, legacyWholesale: wholesale as any, days, now }) });
  } catch (e) {
    next(e);
  }
};
