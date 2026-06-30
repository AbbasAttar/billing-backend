import { NextFunction, Request, Response } from 'express';
import { Cashflow, CASHFLOW_PAYMENT_METHODS, CASHFLOW_STATUSES } from '../models/Cashflow.model';
import { Invoice } from '../models/Invoice.model';
import { fail, ok } from '../utils/response';

const parseDate = (value?: string): Date | null => {
  if (!value) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

export const createCashflow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, date, amount, category, vendorName, note, paymentMethod, dueDate, items } = req.body;

    if (!type || !['expense', 'payable'].includes(type)) {
      return fail(res, 'type must be "expense" or "payable"', 400);
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return fail(res, 'amount must be greater than 0', 400);
    }
    if (!category?.trim()) {
      return fail(res, 'category is required', 400);
    }

    const parsedDate = parseDate(date) ?? new Date();

    if (type === 'expense') {
      if (!paymentMethod || !CASHFLOW_PAYMENT_METHODS.includes(paymentMethod)) {
        return fail(res, 'paymentMethod is required for expense entries', 400);
      }
      const entry = await Cashflow.create({
        type: 'expense',
        date: parsedDate,
        amount,
        paidAmount: 0,
        status: 'logged',
        category,
        vendorName,
        note,
        paymentMethod,
        items: [],
        payments: [],
      });
      return ok(res, entry, 'Expense created', 201);
    }

    // type === 'payable'
    if (!vendorName?.trim()) {
      return fail(res, 'vendorName is required for payable entries', 400);
    }
    const parsedDueDate = parseDate(dueDate);
    if (!parsedDueDate) {
      return fail(res, 'dueDate is required for payable entries', 400);
    }

    const sanitizedItems = Array.isArray(items)
      ? items
          .filter((item: any) => item.description?.trim() && typeof item.amount === 'number' && item.amount >= 0)
          .map((item: any) => ({ description: item.description.trim(), amount: item.amount }))
      : [];

    const entry = new Cashflow({
      type: 'payable',
      date: parsedDate,
      dueDate: parsedDueDate,
      amount,
      paidAmount: 0,
      category,
      vendorName: vendorName.trim(),
      note,
      items: sanitizedItems,
      payments: [],
    });
    await entry.save();
    return ok(res, entry, 'Payable created', 201);
  } catch (error) {
    next(error);
  }
};

export const getCashflow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, status, category, startDate, endDate, includeVoid } = req.query as Record<string, string | undefined>;

    const filter: Record<string, unknown> = {};

    if (type === 'expense' || type === 'payable') {
      filter.type = type;
    }

    if (status && CASHFLOW_STATUSES.includes(status as any)) {
      filter.status = status;
    } else if (includeVoid !== 'true') {
      // Payables never have status "void", so this only excludes voided expenses
      filter.status = { $ne: 'void' };
    }

    if (category) {
      filter.category = category;
    }

    const start = parseDate(startDate);
    const end = parseDate(endDate);
    if (start || end) {
      filter.date = {
        ...(start ? { $gte: start } : {}),
        ...(end ? { $lte: end } : {}),
      };
    }

    const entries = await Cashflow.find(filter).sort({ date: -1 });
    return ok(res, entries);
  } catch (error) {
    next(error);
  }
};

export const getCashflowById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await Cashflow.findById(req.params.id);
    if (!entry) return fail(res, 'Entry not found', 404);
    return ok(res, entry);
  } catch (error) {
    next(error);
  }
};

export const updateCashflow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await Cashflow.findById(req.params.id);
    if (!entry) return fail(res, 'Entry not found', 404);

    const { date, amount, category, vendorName, note, paymentMethod, dueDate, items } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
      return fail(res, 'amount must be greater than 0', 400);
    }
    if (!category?.trim()) {
      return fail(res, 'category is required', 400);
    }

    const parsedDate = parseDate(date);
    if (!parsedDate) return fail(res, 'Invalid date', 400);

    if (entry.type === 'expense') {
      if (!paymentMethod || !CASHFLOW_PAYMENT_METHODS.includes(paymentMethod)) {
        return fail(res, 'paymentMethod is required for expense entries', 400);
      }
      entry.date = parsedDate;
      entry.amount = amount;
      entry.category = category;
      entry.vendorName = vendorName;
      entry.note = note;
      entry.paymentMethod = paymentMethod;
    } else {
      if (!vendorName?.trim()) {
        return fail(res, 'vendorName is required for payable entries', 400);
      }
      const parsedDueDate = parseDate(dueDate);
      if (!parsedDueDate) return fail(res, 'dueDate is required for payable entries', 400);
      if (entry.paidAmount > amount) {
        return fail(res, 'amount cannot be lower than amount already paid', 400);
      }
      entry.date = parsedDate;
      entry.amount = amount;
      entry.dueDate = parsedDueDate;
      entry.category = category;
      entry.vendorName = vendorName.trim();
      entry.note = note;
      if (Array.isArray(items)) {
        entry.items = items
          .filter((item: any) => item.description?.trim() && typeof item.amount === 'number' && item.amount >= 0)
          .map((item: any) => ({ description: item.description.trim(), amount: item.amount }));
      }
    }

    await entry.save();
    return ok(res, entry, 'Entry updated');
  } catch (error) {
    next(error);
  }
};

export const deleteCashflow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await Cashflow.findByIdAndDelete(req.params.id);
    if (!entry) return fail(res, 'Entry not found', 404);
    return ok(res, { _id: entry._id }, 'Entry deleted');
  } catch (error) {
    next(error);
  }
};

export const voidCashflow = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { voidReason } = req.body as { voidReason?: string };
    if (!voidReason?.trim()) return fail(res, 'voidReason is required', 400);

    const entry = await Cashflow.findById(req.params.id);
    if (!entry) return fail(res, 'Entry not found', 404);
    if (entry.type !== 'expense') return fail(res, 'Only expense entries can be voided', 400);
    if (entry.status === 'void') return fail(res, 'Entry already voided', 400);

    entry.status = 'void';
    entry.voidReason = voidReason.trim();
    await entry.save();
    return ok(res, entry, 'Entry voided');
  } catch (error) {
    next(error);
  }
};

export const addPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, method, date, note } = req.body;

    const entry = await Cashflow.findById(req.params.id);
    if (!entry) return fail(res, 'Entry not found', 404);
    if (entry.type !== 'payable') return fail(res, 'Only payable entries support payment recording', 400);

    entry.payments.push({ amount, method, date: date ? new Date(date) : new Date(), note });
    entry.paidAmount += amount;
    await entry.save();
    return ok(res, entry);
  } catch (error) {
    next(error);
  }
};

export const getCashflowSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, type } = req.query as { startDate?: string; endDate?: string; type?: string };
    const start = parseDate(startDate);
    const end = parseDate(endDate);

    const match: Record<string, unknown> = { status: { $ne: 'void' } };

    if (type === 'expense' || type === 'payable') {
      match.type = type;
    }
    if (start || end) {
      match.date = {
        ...(start ? { $gte: start } : {}),
        ...(end ? { $lte: end } : {}),
      };
    }

    const [totals, byCategoryAgg, byPaymentMethodAgg] = await Promise.all([
      Cashflow.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Cashflow.aggregate([{ $match: match }, { $group: { _id: '$category', total: { $sum: '$amount' } } }]),
      Cashflow.aggregate([
        { $match: { ...match, type: 'expense' } },
        { $group: { _id: '$paymentMethod', total: { $sum: '$amount' } } },
      ]),
    ]);

    const byCategory: Record<string, number> = {};
    for (const row of byCategoryAgg) {
      byCategory[row._id as string] = row.total;
    }

    const byPaymentMethod: Record<string, number> = { cash: 0, upi: 0, card: 0, bank_transfer: 0 };
    for (const row of byPaymentMethodAgg) {
      byPaymentMethod[row._id as string] = row.total;
    }

    return ok(res, {
      total: totals[0]?.total ?? 0,
      count: totals[0]?.count ?? 0,
      byCategory,
      byPaymentMethod,
    });
  } catch (error) {
    next(error);
  }
};

export const getAISuggestion = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const revenueData = await Invoice.aggregate([
      { $unwind: '$payments' },
      { $match: { 'payments.date': { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$payments.date' } },
          amount: { $sum: '$payments.amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totalRevenue = revenueData.reduce((sum: number, d: any) => sum + d.amount, 0);
    const avgDailyRevenue = totalRevenue / 30;

    const pendingPayables = await Cashflow.find({ type: 'payable', status: { $ne: 'paid' } }).sort({ dueDate: 1 });
    const totalPendingAmount = pendingPayables.reduce((sum, e) => sum + (e.amount - e.paidAmount), 0);

    const dailyAllocation = avgDailyRevenue * 0.4;
    let remainingAllocation = dailyAllocation * 7;
    const suggestions = [];

    for (const payable of pendingPayables) {
      const balance = payable.amount - payable.paidAmount;
      if (remainingAllocation <= 0) break;

      const payment = Math.min(balance, remainingAllocation);
      if (payment > 0) {
        suggestions.push({
          entryId: payable._id,
          vendorName: payable.vendorName,
          dueDate: payable.dueDate,
          totalAmount: payable.amount,
          balance,
          suggestedPayment: payment,
          priority:
            payable.dueDate && payable.dueDate < new Date()
              ? 'CRITICAL (Overdue)'
              : payable.dueDate && payable.dueDate.getTime() - Date.now() < 86400000 * 3
                ? 'HIGH'
                : 'MEDIUM',
        });
        remainingAllocation -= payment;
      }
    }

    return ok(res, {
      summary: { avgDailyRevenue, weeklyBillBudget: dailyAllocation * 7, totalPendingAmount },
      suggestions,
      insight: `Based on your average daily revenue of Rs ${avgDailyRevenue.toFixed(2)}, you can safely allocate Rs ${(dailyAllocation * 7).toFixed(2)} per week towards clearing pending payables. Prioritizing overdue and near-deadline payables.`,
    });
  } catch (error) {
    next(error);
  }
};
