import { Request, Response, NextFunction } from 'express';
import { Invoice } from '../models/Invoice.model';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { LensStock } from '../models/LensStock.model';
import { WholesaleItem } from '../models/WholesaleItem.model';
import { buildFragranceInsights } from '../services/categoryInsights';
import { wholesaleEntries } from '../services/wholesaleCatalog';
import { buildOpticsInsights } from '../services/opticsInsights';
import { buildFrameMix } from '../services/frameMix';
import { buildReadingStock } from '../services/readingStock';
import { buildFittingInsights } from '../services/fittingInsights';
import { FittingJob } from '../models/FittingJob.model';
import { FittingParty } from '../models/FittingParty.model';
import { FittingStatement } from '../models/FittingStatement.model';

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
  Invoice.find({ billDate: { $gte: from, $lte: to } }).select({ billDate: 1, items: 1, customer: 1 }).populate('items').lean();

/** The same number of days just before the window. */
function previousWindow(from: Date, days: number) {
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from);
  prevFrom.setDate(prevFrom.getDate() - days);
  return { prevFrom, prevTo };
}

/** GET /analytics/insights/optics?days=30|90|180|365 — frames and lenses, compared with the previous period. */
export const getOpticsInsights = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days, now, from } = windowFor(req);
    const { prevFrom, prevTo } = previousWindow(from, days);
    const [invoices, previousInvoices, frames, lensStock, fittingJobs, prevFittingJobs, openFittingJobs, fittingParties, fittingStatements] = await Promise.all([
      periodInvoices(from, now),
      periodInvoices(prevFrom, prevTo),
      Frame.find({}).select('name houseName companyName type category costPrice sellPrice storePrice mrp stock createdAt isArchived web').lean(),
      LensStock.find({}).select('lensType material coating color sph cyl add quantity').lean(),
      FittingJob.find({ date: { $gte: from, $lte: now } }).lean(),
      FittingJob.find({ date: { $gte: prevFrom, $lte: prevTo } }).lean(),
      FittingJob.find({ billed: false }).lean(),
      FittingParty.find({}).lean(),
      FittingStatement.find({}).select('party total status paidAt').lean(),
    ]);
    res.json({
      from: from.toISOString(), to: now.toISOString(),
      ...buildOpticsInsights({ invoices: invoices as any, previousInvoices: previousInvoices as any, frames: frames as any, lensStock: lensStock as any, days, now }),
      frameMix: buildFrameMix({ invoices: invoices as any, frames: frames as any }),
      fitting: buildFittingInsights({
        jobs: fittingJobs as any,
        previousJobs: prevFittingJobs as any,
        openJobs: openFittingJobs as any,
        parties: fittingParties as any,
        statements: fittingStatements as any,
        from,
        now,
      }),
    });
  } catch (e) {
    next(e);
  }
};

/** GET /analytics/insights/fragrance?days=… — retail fragrances and wholesale stock: sales, stock and guidance. */
export const getFragranceInsights = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days, now, from } = windowFor(req);
    const { prevFrom, prevTo } = previousWindow(from, days);
    const [invoices, previousInvoices, fragrances, wholesale] = await Promise.all([
      periodInvoices(from, now),
      periodInvoices(prevFrom, prevTo),
      Fragrance.find({}).lean(),
      WholesaleItem.find({}).select('name companyName unit costPrice stock reorderLevel isOrdered orderedQty orderedAt isArchived migratedTo').lean(),
    ]);
    // Wholesale stock now lives on fragrance records; old items that were not moved still count.
    const entries = wholesaleEntries((fragrances as any[]).filter((f) => !f.isArchived)).map((e) => ({ ...e, _id: e._id }));
    const unmoved = (wholesale as any[]).filter((w) => !w.migratedTo);
    res.json({ from: from.toISOString(), to: now.toISOString(), ...buildFragranceInsights({ invoices: invoices as any, fragrances: fragrances as any, wholesale: [...entries, ...unmoved] as any, legacyWholesale: wholesale as any, previousInvoices: previousInvoices as any, days, now }) });
  } catch (e) {
    next(e);
  }
};

/** GET /analytics/insights/reading?days=… — reading glasses on the shelf by power and colour, and what sold. */
export const getReadingInsights = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days, now, from } = windowFor(req);
    const [invoices, frames] = await Promise.all([
      periodInvoices(from, now),
      Frame.find({}).select('name houseName companyName type category readingType costPrice sellPrice storePrice mrp stock isArchived web').lean(),
    ]);
    res.json({ from: from.toISOString(), to: now.toISOString(), ...buildReadingStock({ invoices: invoices as any, frames: frames as any, days }) });
  } catch (e) {
    next(e);
  }
};
