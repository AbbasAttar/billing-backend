import { Request, Response, NextFunction } from 'express';
import { DebtConfig } from '../models/DebtConfig.model';
import { ok } from '../utils/response';

export const getConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await DebtConfig.findOne();
    res.json(config ?? { expectedShopIncome: 0, otherIncome: 0, safetyBuffer: 0 });
  } catch (err) { next(err); }
};

export const upsertConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { expectedShopIncome, otherIncome, safetyBuffer } = req.body;
    const update: Record<string, number> = {};
    if (typeof expectedShopIncome === 'number') update.expectedShopIncome = expectedShopIncome;
    if (typeof otherIncome === 'number') update.otherIncome = otherIncome;
    if (typeof safetyBuffer === 'number') update.safetyBuffer = safetyBuffer;

    const config = await DebtConfig.findOneAndUpdate({}, update, { new: true, upsert: true });
    return ok(res, config, 'Config saved');
  } catch (err) { next(err); }
};
