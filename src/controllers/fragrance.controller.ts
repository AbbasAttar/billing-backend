import { Request, Response, NextFunction } from 'express';
import { Fragrance } from '../models/Fragrance.model';

export const getAllFragrances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await Fragrance.find().sort({ companyName: 1, name: 1 });
    res.json(items);
  } catch (error) {
    next(error);
  }
};

export const searchFragrances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const items = await Fragrance.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { companyName: { $regex: q, $options: 'i' } },
        { type: { $regex: q, $options: 'i' } },
      ],
    }).limit(20);
    res.json(items);
  } catch (error) {
    next(error);
  }
};

export const getFragranceById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await Fragrance.findById(req.params.id);
    if (!item) {
      res.status(404).json({ message: 'Fragrance not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
};

export const createFragrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = new Fragrance(req.body);
    const saved = await item.save();
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
};

export const updateFragrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await Fragrance.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) {
      res.status(404).json({ message: 'Fragrance not found' });
      return;
    }
    res.json(item);
  } catch (error) {
    next(error);
  }
};

export const deleteFragrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await Fragrance.findByIdAndDelete(req.params.id);
    if (!item) {
      res.status(404).json({ message: 'Fragrance not found' });
      return;
    }
    res.json({ message: 'Fragrance deleted' });
  } catch (error) {
    next(error);
  }
};
