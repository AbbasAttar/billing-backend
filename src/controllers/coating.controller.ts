import { Request, Response, NextFunction } from 'express';
import { Coating } from '../models/Coating.model';
import { ok, fail } from '../utils/response';

const DEFAULT_COATINGS = [
  'Hard Coat', 'Anti-Reflective', 'Blue Cut', 'Blue Cut Blue',
  'Photochromic Hard Coat', 'Photochromic Blue Cut',
  'Polycarbonate Blue Cut', 'Polycarbonate Blue Cut Blue',
  'Polycarbonate Photochromic Blue Cut', 'Tinted', 'Other',
];

export const getCoatings = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let coatings = await Coating.find().sort({ name: 1 });
    if (coatings.length === 0) {
      await Coating.insertMany(DEFAULT_COATINGS.map((name) => ({ name })));
      coatings = await Coating.find().sort({ name: 1 });
    }
    return ok(res, coatings);
  } catch (e) { next(e); }
};

export const createCoating = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return fail(res, 'name is required', 400);
    const coating = await Coating.create({ name: name.trim() });
    return ok(res, coating, 'Coating created', 201);
  } catch (e: any) {
    if (e.code === 11000) return fail(res, 'A coating with this name already exists', 409);
    next(e);
  }
};

export const updateCoating = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) return fail(res, 'name is required', 400);
    const coating = await Coating.findByIdAndUpdate(
      req.params.id,
      { name: name.trim() },
      { new: true, runValidators: true }
    );
    if (!coating) return fail(res, 'Coating not found', 404);
    return ok(res, coating);
  } catch (e: any) {
    if (e.code === 11000) return fail(res, 'A coating with this name already exists', 409);
    next(e);
  }
};

export const deleteCoating = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const coating = await Coating.findByIdAndDelete(req.params.id);
    if (!coating) return fail(res, 'Coating not found', 404);
    return ok(res, { _id: coating._id }, 'Coating deleted');
  } catch (e) { next(e); }
};
