import { Request, Response, NextFunction } from 'express';
import { ContactLens } from '../models/ContactLens.model';

export const getAllContactLenses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lenses = await ContactLens.find().sort({ brand: 1, name: 1 });
    res.json(lenses);
  } catch (err) {
    next(err);
  }
};

export const searchContactLenses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const filter: any = q
      ? { $or: [{ name: { $regex: q, $options: 'i' } }, { brand: { $regex: q, $options: 'i' } }] }
      : {};
    const lenses = await ContactLens.find(filter).limit(20);
    res.json(lenses);
  } catch (err) {
    next(err);
  }
};

export const getContactLensById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lens = await ContactLens.findById(req.params.id);
    if (!lens) { res.status(404).json({ message: 'Contact lens not found' }); return; }
    res.json(lens);
  } catch (err) {
    next(err);
  }
};

export const createContactLens = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lens = new ContactLens(req.body);
    const saved = await lens.save();
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
};

export const updateContactLens = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lens = await ContactLens.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!lens) { res.status(404).json({ message: 'Contact lens not found' }); return; }
    res.json(lens);
  } catch (err) {
    next(err);
  }
};

export const deleteContactLens = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lens = await ContactLens.findByIdAndDelete(req.params.id);
    if (!lens) { res.status(404).json({ message: 'Contact lens not found' }); return; }
    res.json({ message: 'Contact lens deleted' });
  } catch (err) {
    next(err);
  }
};
