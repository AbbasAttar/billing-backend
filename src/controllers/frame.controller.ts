import { Request, Response, NextFunction } from 'express';
import { Frame } from '../models/Frame.model';

export const getAllFrames = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await Frame.find().sort({ companyName: 1, name: 1 });
    res.json(items);
  } catch (error) {
    next(error);
  }
};

export const searchFrames = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const items = await Frame.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { companyName: { $regex: q, $options: 'i' } },
      ],
    }).limit(20);
    res.json(items);
  } catch (error) {
    next(error);
  }
};

export const getFrameById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await Frame.findById(req.params.id);
    if (!item) {
      res.status(404).json({ message: 'Frame not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
};

export const createFrame = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = new Frame(req.body);
    const saved = await item.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const updateFrame = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await Frame.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) {
      res.status(404).json({ message: 'Frame not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
};

export const deleteFrame = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await Frame.findByIdAndDelete(req.params.id);
    if (!item) {
      res.status(404).json({ message: 'Frame not found' });
      return;
    }
    res.json({ message: 'Frame deleted' });
  } catch (error) {
    next(error);
  }
};
