import { Request, Response, NextFunction } from 'express';
import { Frame } from '../models/Frame.model';
import { InvoiceItem } from '../models/InvoiceItem.model';

function buildFrameQuery(q: string) {
  if (!q) return {};
  // Exact 10-digit code → search by frameCode first
  if (/^\d{10}$/.test(q)) {
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
    const frame = await Frame.findByIdAndUpdate(req.params.id, req.body, {
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
