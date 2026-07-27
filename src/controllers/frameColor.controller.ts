import { Request, Response, NextFunction } from 'express';
import { FrameColor } from '../models/FrameColor.model';

export const getAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const colors = await FrameColor.find().sort({ name: 1 });
    res.json(colors);
  } catch (e) { next(e); }
};

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, hex } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'name is required' });
    if (!hex?.trim())  return res.status(400).json({ message: 'hex is required' });
    const color = await FrameColor.create({ name: name.trim(), hex: hex.trim() });
    res.status(201).json(color);
  } catch (e: any) {
    if (e.code === 11000) return res.status(409).json({ message: 'A color with this name already exists' });
    next(e);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patch: Record<string, string> = {};
    if (req.body.name) patch.name = req.body.name.trim();
    if (req.body.hex)  patch.hex  = req.body.hex.trim();
    const color = await FrameColor.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
    if (!color) return res.status(404).json({ message: 'Color not found' });
    res.json(color);
  } catch (e: any) {
    if (e.code === 11000) return res.status(409).json({ message: 'A color with this name already exists' });
    next(e);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const color = await FrameColor.findByIdAndDelete(req.params.id);
    if (!color) return res.status(404).json({ message: 'Color not found' });
    res.json({ _id: color._id });
  } catch (e) { next(e); }
};
