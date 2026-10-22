import { Request, Response, NextFunction } from 'express';
import { mergePlan } from '../services/fragranceMerge';
import { Fragrance } from '../models/Fragrance.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Invoice } from '../models/Invoice.model';
import { tokenSearch, SEARCH_MARKERS } from '../services/tokenSearch';

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
    if (q) {
      const found = await tokenSearch(Fragrance, q, {
        marker: SEARCH_MARKERS.fragrances,
        limit: 100,
        predicate: (f) => (archivedOnly ? f.isArchived === true : f.isArchived !== true),
      });
      if (found) {
        res.json(
          found.sort((a, b) => String(a.companyName ?? '').localeCompare(String(b.companyName ?? '')) || String(a.name ?? '').localeCompare(String(b.name ?? ''))),
        );
        return;
      }
    }
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
    // Billing searches retail items; bulk oil and packaging (not ticked Retail) only with ?all=true.
    const all = req.query.all === 'true';
    const sellable = (f: any) => f.isArchived !== true && (all || f.channels?.retail !== false);
    const found = q
      ? await tokenSearch(Fragrance, q, { marker: SEARCH_MARKERS.fragrances, limit: 15, predicate: sellable })
      : null;
    if (found) {
      res.json(found);
      return;
    }
    const fragrances = await Fragrance.find({
      isArchived: { $ne: true },
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { companyName: { $regex: q, $options: 'i' } },
      ],
    }).limit(30);
    res.json((fragrances as any[]).filter(sellable).slice(0, 15));
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

/** POST /fragrances/:id/merge { fromId } — merge a duplicate into this one (owner only, see accessPolicy). */
export const mergeFragrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fromId = typeof req.body?.fromId === 'string' ? req.body.fromId : '';
    const [keep, dup]: any[] = await Promise.all([Fragrance.findById(req.params.id).lean(), fromId ? Fragrance.findById(fromId).lean() : null]);
    if (!keep || !dup) {
      res.status(404).json({ message: 'Fragrance not found' });
      return;
    }
    const plan = mergePlan(keep, dup);
    if ('error' in plan) {
      res.status(400).json({ message: plan.error });
      return;
    }
    const kept = await Fragrance.findByIdAndUpdate(String(req.params.id), { $set: plan.update }, { new: true });
    // The duplicate is archived, not deleted: old bills still show it. Its stock now counts on the kept one.
    await Fragrance.findByIdAndUpdate(fromId, {
      $set: { isArchived: true, archivedAt: new Date(), stock: 0, variants: (dup.variants ?? []).map((v: any) => ({ ...v, stock: 0 })), mergedInto: String(req.params.id), 'web.isPublished': false },
    });
    res.json(kept);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /fragrances/:id/not-duplicate { otherId, undo? } — mark two same-name products as different
 * so the duplicate check stops pairing them (owner only). Stored on both: `notDuplicateOf` ids.
 */
export const markNotDuplicate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const otherId = typeof req.body?.otherId === 'string' ? req.body.otherId : '';
    const undo = req.body?.undo === true;
    if (!otherId || otherId === id) {
      res.status(400).json({ message: 'Pick two different products' });
      return;
    }
    const [a, b]: any[] = await Promise.all([Fragrance.findById(id).lean(), Fragrance.findById(otherId).lean()]);
    if (!a || !b) {
      res.status(404).json({ message: 'Fragrance not found' });
      return;
    }
    const withPair = (doc: any, other: string) => {
      const ids = new Set<string>((doc.notDuplicateOf ?? []).map(String));
      if (undo) ids.delete(other);
      else ids.add(other);
      return [...ids];
    };
    await Promise.all([
      Fragrance.findByIdAndUpdate(id, { $set: { notDuplicateOf: withPair(a, otherId) } }),
      Fragrance.findByIdAndUpdate(otherId, { $set: { notDuplicateOf: withPair(b, id) } }),
    ]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
};
