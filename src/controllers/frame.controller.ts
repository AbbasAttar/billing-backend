import { Request, Response, NextFunction } from 'express';
import { Frame } from '../models/Frame.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { calculateDefaultFramePricing } from '../utils/pricing.utils';
import { tokenSearch, SEARCH_MARKERS } from '../services/tokenSearch';
import { isCatchAllFrame } from '../services/catchAllProducts';
import { cleanTagInput, missingModelAttrs, modelColors, modelSizes, tagFrameSet } from '../services/frameAttributes';
import { FrameColor } from '../models/FrameColor.model';

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

/** Token search for the POS / admin frame pickers (exact frame code first). Null until tokens are backfilled. */
async function searchFramesByToken(q: string, limit: number, archivedOnly = false) {
  if (/^d{10,16}$/.test(q)) {
    const exact = await Frame.find({ frameCode: q }).limit(5).lean();
    const visible = (exact as any[]).filter((f) => (archivedOnly ? f.isArchived === true : f.isArchived !== true));
    if (visible.length > 0) return visible;
  }
  const found = await tokenSearch(Frame, q, {
    marker: SEARCH_MARKERS.frames,
    limit,
    predicate: (f) => (archivedOnly ? f.isArchived === true : f.isArchived !== true),
  });
  return found
    ? found.sort((a, b) => String(a.companyName ?? '').localeCompare(String(b.companyName ?? '')) || String(a.name ?? '').localeCompare(String(b.name ?? '')))
    : null;
}

export const getAllFrames = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const archivedOnly = req.query.archived === '1';
    if (q) {
      const found = await searchFramesByToken(q, 100, archivedOnly);
      if (found) {
        res.json(found);
        return;
      }
    }
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
    const found = q ? await searchFramesByToken(q, 15) : null;
    if (found) {
      res.json(found);
      return;
    }
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

// ── FRAME TAGS ────────────────────────────────────────────────────────────────

/**
 * GET /frames/tag-queue?page=1&limit=25 — frames still missing category, reading type, shape,
 * material, eye sizes or colours, best sellers first, then the most stock. Tagging a model also
 * fixes the reports for its old sales.
 */
export const getFrameTagQueue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 25, 5), 100);
    const [frames, items] = await Promise.all([
      Frame.find({ isArchived: { $ne: true } }).lean(),
      InvoiceItem.find({}).select('frame quantity').lean(),
    ]);
    const sold = new Map<string, number>();
    for (const it of items as any[]) {
      if (!it.frame) continue;
      const id = String(it.frame?._id ?? it.frame);
      sold.set(id, (sold.get(id) ?? 0) + (it.quantity > 0 ? it.quantity : 1));
    }
    const active = (frames as any[]).filter((f) => !isCatchAllFrame(f));
    const queue = active
      .map((f) => ({ f, missing: missingModelAttrs(f), sold: sold.get(String(f._id)) ?? 0 }))
      .filter((x) => x.missing.length > 0 && (x.sold > 0 || (x.f.stock ?? 0) > 0))
      .sort((a, b) => b.sold - a.sold || (b.f.stock ?? 0) - (a.f.stock ?? 0) || String(a.f._id).localeCompare(String(b.f._id)));
    const pages = Math.max(1, Math.ceil(queue.length / limit));
    const page = Math.min(Math.max(parseInt(req.query.page as string) || 1, 1), pages);
    res.json({
      total: active.length,
      remaining: queue.length,
      page,
      pages,
      limit,
      frames: queue.slice((page - 1) * limit, page * limit).map(({ f, missing, sold: units }) => ({
        _id: f._id, name: f.name, houseName: f.houseName, companyName: f.companyName, type: f.type,
        category: f.category, readingType: f.readingType,
        stock: f.stock ?? 0, sellPrice: f.sellPrice, sold: units, missing,
        colors: modelColors(f), sizes: modelSizes(f),
        web: { shape: f.web?.shape, material: f.web?.material, gender: f.web?.gender, frameVariants: f.web?.frameVariants },
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /frames/:id/tags — record category, reading type, rim, shape, material, gender, and the
 * colours / eye sizes the model comes in (`colors`, `sizes` replace the lists).
 */
export const tagFrame = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tags = cleanTagInput(req.body);
    const palette = tags.colors?.length || tags.color
      ? new Map((await FrameColor.find({}).lean() as any[]).map((c) => [String(c.name).toLowerCase(), c.hex]))
      : undefined;
    const set = tagFrameSet(tags, palette);
    if (!Object.keys(set).length) {
      res.status(400).json({ message: 'Nothing to tag.' });
      return;
    }
    const frame = await Frame.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
    if (!frame) {
      res.status(404).json({ message: 'Frame not found' });
      return;
    }
    res.json(frame);
  } catch (error) {
    next(error);
  }
};
