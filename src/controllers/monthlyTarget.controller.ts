import { NextFunction, Request, Response } from 'express';
import { MonthlyTarget } from '../models/MonthlyTarget.model';
import { fail, ok } from '../utils/response';

const isValidMonth = (value: string): boolean => /^\d{4}-\d{2}$/.test(value);

export const upsertMonthlyTarget = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { month } = req.params;
    if (!isValidMonth(String(month))) return fail(res, 'month must be in YYYY-MM format', 400);

    const { revenueTarget, expenseBudget, personalBudget, notes } = req.body as {
      revenueTarget?: number;
      expenseBudget?: number;
      personalBudget?: number;
      notes?: string;
    };

    if (typeof revenueTarget !== 'number' || revenueTarget < 0)
      return fail(res, 'revenueTarget must be a non-negative number', 400);
    if (typeof expenseBudget !== 'number' || expenseBudget < 0)
      return fail(res, 'expenseBudget must be a non-negative number', 400);
    if (typeof personalBudget !== 'number' || personalBudget < 0)
      return fail(res, 'personalBudget must be a non-negative number', 400);

    const target = await MonthlyTarget.findOneAndUpdate(
      { month },
      { revenueTarget, expenseBudget, personalBudget, notes },
      { upsert: true, new: true, runValidators: true }
    );
    return ok(res, target, 'Monthly target saved', 200);
  } catch (error) {
    next(error);
  }
};

export const getMonthlyTargets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targets = await MonthlyTarget.find().sort({ month: -1 }).limit(24);
    return ok(res, targets);
  } catch (error) {
    next(error);
  }
};

export const getCurrentMonthTarget = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const target = await MonthlyTarget.findOne({ month });
    return ok(res, target ?? null);
  } catch (error) {
    next(error);
  }
};

export const getMonthlyTargetByMonth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { month } = req.params;
    if (!isValidMonth(String(month))) return fail(res, 'month must be in YYYY-MM format', 400);
    const target = await MonthlyTarget.findOne({ month });
    if (!target) return fail(res, 'No target found for this month', 404);
    return ok(res, target);
  } catch (error) {
    next(error);
  }
};

export const deleteMonthlyTarget = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const target = await MonthlyTarget.findByIdAndDelete(req.params.id);
    if (!target) return fail(res, 'Monthly target not found', 404);
    return ok(res, { _id: target._id }, 'Monthly target deleted');
  } catch (error) {
    next(error);
  }
};
