import { NextFunction, Request, Response } from 'express';
import {
  PersonalExpense,
  PERSONAL_EXPENSE_CATEGORIES,
  PERSONAL_PAYMENT_METHODS,
} from '../models/PersonalExpense.model';
import { fail, ok } from '../utils/response';

const isValidDate = (value?: string): Date | null => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
};

export const createPersonalExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, amount, category, note, paymentMethod, isRecurring, recurringDay } = req.body as {
      date?: string;
      amount?: number;
      category?: string;
      note?: string;
      paymentMethod?: string;
      isRecurring?: boolean;
      recurringDay?: number;
    };

    if (typeof amount !== 'number' || amount <= 0) return fail(res, 'amount must be greater than 0', 400);
    if (!category || !PERSONAL_EXPENSE_CATEGORIES.includes(category as any))
      return fail(res, `Invalid category. Must be one of: ${PERSONAL_EXPENSE_CATEGORIES.join(', ')}`, 400);
    if (!paymentMethod || !PERSONAL_PAYMENT_METHODS.includes(paymentMethod as any))
      return fail(res, 'Invalid paymentMethod', 400);

    const parsedDate = date ? isValidDate(date) : new Date();
    if (!parsedDate) return fail(res, 'Invalid date', 400);

    if (isRecurring && recurringDay !== undefined) {
      if (!Number.isInteger(recurringDay) || recurringDay < 1 || recurringDay > 31)
        return fail(res, 'recurringDay must be 1–31', 400);
    }

    const expense = await PersonalExpense.create({
      date: parsedDate,
      amount,
      category,
      note,
      paymentMethod,
      isRecurring: isRecurring ?? false,
      recurringDay: isRecurring ? recurringDay : undefined,
    });
    return ok(res, expense, 'Personal expense created', 201);
  } catch (error) {
    next(error);
  }
};

export const updatePersonalExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, amount, category, note, paymentMethod, isRecurring, recurringDay } = req.body as {
      date?: string;
      amount?: number;
      category?: string;
      note?: string;
      paymentMethod?: string;
      isRecurring?: boolean;
      recurringDay?: number;
    };

    if (typeof amount !== 'number' || amount <= 0) return fail(res, 'amount must be greater than 0', 400);
    if (!category || !PERSONAL_EXPENSE_CATEGORIES.includes(category as any))
      return fail(res, 'Invalid category', 400);
    if (!paymentMethod || !PERSONAL_PAYMENT_METHODS.includes(paymentMethod as any))
      return fail(res, 'Invalid paymentMethod', 400);

    const parsedDate = date ? isValidDate(date) : null;
    if (!parsedDate) return fail(res, 'Invalid date', 400);

    const expense = await PersonalExpense.findById(req.params.id);
    if (!expense) return fail(res, 'Personal expense not found', 404);

    expense.date = parsedDate;
    expense.amount = amount;
    expense.category = category as any;
    expense.note = note;
    expense.paymentMethod = paymentMethod as any;
    expense.isRecurring = isRecurring ?? false;
    expense.recurringDay = isRecurring ? recurringDay : undefined;
    await expense.save();

    return ok(res, expense, 'Personal expense updated');
  } catch (error) {
    next(error);
  }
};

export const getPersonalExpenses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, category } = req.query as {
      startDate?: string;
      endDate?: string;
      category?: string;
    };

    const filter: Record<string, unknown> = {};
    const start = isValidDate(startDate);
    const end = isValidDate(endDate);
    if (startDate && !start) return fail(res, 'Invalid startDate', 400);
    if (endDate && !end) return fail(res, 'Invalid endDate', 400);

    if (start || end) {
      filter.date = {
        ...(start ? { $gte: start } : {}),
        ...(end ? { $lte: end } : {}),
      };
    }
    if (category) {
      if (!PERSONAL_EXPENSE_CATEGORIES.includes(category as any))
        return fail(res, 'Invalid category filter', 400);
      filter.category = category;
    }

    const expenses = await PersonalExpense.find(filter).sort({ date: -1 });
    return ok(res, expenses);
  } catch (error) {
    next(error);
  }
};

export const getPersonalExpenseById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await PersonalExpense.findById(req.params.id);
    if (!expense) return fail(res, 'Personal expense not found', 404);
    return ok(res, expense);
  } catch (error) {
    next(error);
  }
};

export const deletePersonalExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await PersonalExpense.findByIdAndDelete(req.params.id);
    if (!expense) return fail(res, 'Personal expense not found', 404);
    return ok(res, { _id: expense._id }, 'Personal expense deleted');
  } catch (error) {
    next(error);
  }
};

export const getPersonalExpenseSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const start = isValidDate(startDate);
    const end = isValidDate(endDate);
    if (startDate && !start) return fail(res, 'Invalid startDate', 400);
    if (endDate && !end) return fail(res, 'Invalid endDate', 400);

    const match: Record<string, unknown> = {};
    if (start || end) {
      match.date = {
        ...(start ? { $gte: start } : {}),
        ...(end ? { $lte: end } : {}),
      };
    }

    const [totals, byCategoryAgg] = await Promise.all([
      PersonalExpense.aggregate([
        { $match: match },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      PersonalExpense.aggregate([
        { $match: match },
        { $group: { _id: '$category', total: { $sum: '$amount' } } },
      ]),
    ]);

    const byCategory: Record<string, number> = Object.fromEntries(
      PERSONAL_EXPENSE_CATEGORIES.map((c) => [c, 0])
    );
    for (const row of byCategoryAgg) {
      if (row._id in byCategory) byCategory[row._id] = row.total;
    }

    return ok(res, {
      total: totals[0]?.total ?? 0,
      count: totals[0]?.count ?? 0,
      byCategory,
    });
  } catch (error) {
    next(error);
  }
};
