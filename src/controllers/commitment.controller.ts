import { Request, Response, NextFunction } from 'express';
import { Commitment } from '../models/Commitment.model';
import { fail, ok } from '../utils/response';

export const listCommitments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await Commitment.find().sort({ name: 1 });
    res.json(items);
  } catch (err) { next(err); }
};

export const createCommitment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, amount, dueDay, isEssential, notes } = req.body;
    if (!name?.trim()) return fail(res, 'name is required', 400);
    if (typeof amount !== 'number' || amount < 0) return fail(res, 'amount must be >= 0', 400);

    const item = await Commitment.create({
      name: name.trim(),
      amount,
      dueDay: dueDay ?? undefined,
      isEssential: isEssential ?? true,
      notes: notes?.trim(),
    });
    return ok(res, item, 'Commitment created', 201);
  } catch (err) { next(err); }
};

export const updateCommitment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['name', 'amount', 'dueDay', 'isEssential', 'notes'];
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    const item = await Commitment.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!item) return fail(res, 'Commitment not found', 404);
    return ok(res, item, 'Updated');
  } catch (err) { next(err); }
};

export const deleteCommitment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await Commitment.findByIdAndDelete(req.params.id);
    if (!item) return fail(res, 'Commitment not found', 404);
    return ok(res, { _id: req.params.id }, 'Deleted');
  } catch (err) { next(err); }
};
