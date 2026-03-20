import { NextFunction, Request, Response } from 'express';
import { Expense, EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS } from '../models/Expense.model';
import { fail, ok } from '../utils/response';

const isValidDate = (value?: string): Date | null => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
};

export const createExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { date, amount, category, note, vendorName, paymentMethod, isVoid, voidReason } = req.body as {
      date?: string;
      amount?: number;
      category?: string;
      note?: string;
      vendorName?: string;
      paymentMethod?: string;
      isVoid?: boolean;
      voidReason?: string;
    };

    if (isVoid !== undefined || voidReason !== undefined) {
      return fail(res, 'isVoid and voidReason are not allowed at creation time', 400);
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return fail(res, 'amount must be greater than 0', 400);
    }
    if (!category || !EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
      return fail(res, 'Invalid expense category', 400);
    }
    if (!paymentMethod || !EXPENSE_PAYMENT_METHODS.includes(paymentMethod as (typeof EXPENSE_PAYMENT_METHODS)[number])) {
      return fail(res, 'Invalid paymentMethod', 400);
    }

    const parsedDate = date ? isValidDate(date) : new Date();
    if (!parsedDate) {
      return fail(res, 'Invalid date', 400);
    }

    const expense = await Expense.create({
      date: parsedDate,
      amount,
      category,
      note,
      vendorName,
      paymentMethod,
    });
    return ok(res, expense, 'Expense created', 201);
  } catch (error) {
    next(error);
  }
};

export const getExpenses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, category, includeVoid } = req.query as {
      startDate?: string;
      endDate?: string;
      category?: string;
      includeVoid?: string;
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
      if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
        return fail(res, 'Invalid category filter', 400);
      }
      filter.category = category;
    }

    if (includeVoid !== 'true') {
      filter.isVoid = false;
    }

    const expenses = await Expense.find(filter).sort({ date: -1 });
    return ok(res, expenses);
  } catch (error) {
    next(error);
  }
};

export const getExpenseById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return fail(res, 'Expense not found', 404);
    return ok(res, expense);
  } catch (error) {
    next(error);
  }
};

export const getExpenseSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const start = isValidDate(startDate);
    const end = isValidDate(endDate);
    if (startDate && !start) return fail(res, 'Invalid startDate', 400);
    if (endDate && !end) return fail(res, 'Invalid endDate', 400);

    const match: Record<string, unknown> = { isVoid: false };
    if (start || end) {
      match.date = {
        ...(start ? { $gte: start } : {}),
        ...(end ? { $lte: end } : {}),
      };
    }

    const [totals, byCategoryAgg, byPaymentMethodAgg] = await Promise.all([
      Expense.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Expense.aggregate([{ $match: match }, { $group: { _id: '$category', total: { $sum: '$amount' } } }]),
      Expense.aggregate([{ $match: match }, { $group: { _id: '$paymentMethod', total: { $sum: '$amount' } } }]),
    ]);

    const byCategory = {
      rent: 0,
      salary: 0,
      utilities: 0,
      stock: 0,
      maintenance: 0,
      transport: 0,
      marketing: 0,
      miscellaneous: 0,
    };

    const byPaymentMethod = {
      cash: 0,
      upi: 0,
      card: 0,
      bank_transfer: 0,
    };

    for (const row of byCategoryAgg) {
      const key = row._id as keyof typeof byCategory;
      if (key in byCategory) byCategory[key] = row.total;
    }
    for (const row of byPaymentMethodAgg) {
      const key = row._id as keyof typeof byPaymentMethod;
      if (key in byPaymentMethod) byPaymentMethod[key] = row.total;
    }

    return ok(res, {
      totalExpenses: totals[0]?.total ?? 0,
      byCategory,
      byPaymentMethod,
      count: totals[0]?.count ?? 0,
    });
  } catch (error) {
    next(error);
  }
};

export const voidExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { voidReason } = req.body as { voidReason?: string };
    if (!voidReason?.trim()) return fail(res, 'voidReason is required', 400);

    const expense = await Expense.findById(req.params.id);
    if (!expense) return fail(res, 'Expense not found', 404);
    if (expense.isVoid) return fail(res, 'Expense already voided', 400);

    expense.isVoid = true;
    expense.voidReason = voidReason.trim();
    await expense.save();

    return ok(res, expense, 'Expense voided');
  } catch (error) {
    next(error);
  }
};

