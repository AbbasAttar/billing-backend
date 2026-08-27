import { NextFunction, Request, Response } from 'express';
import { Expense, EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS } from '../models/Expense.model';
import { Invoice } from '../models/Invoice.model';
import { VendorBill } from '../models/VendorBill.model';
import { RecurringExpense } from '../models/RecurringExpense.model';
import { fail, ok } from '../utils/response';

const MANAGER_PIN = '1959';

const isValidDate = (value?: string): Date | null => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
};

const getTodayStart = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
};

const getTodayEnd = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
};

const isPastSettledDate = (date: Date): boolean => {
  const itemDate = new Date(date);
  itemDate.setHours(0, 0, 0, 0);
  const today = getTodayStart();
  return itemDate.getTime() < today.getTime();
};

const checkManagerAuthorization = (req: Request): boolean => {
  const pin = req.body?.managerPin || req.headers['x-manager-pin'] || req.query?.managerPin;
  const override = req.body?.managerOverride === true;
  return pin === MANAGER_PIN || override;
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

export const updateExpense = async (req: Request, res: Response, next: NextFunction) => {
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
      return fail(res, 'Use the dedicated void endpoint for void operations', 400);
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

    const parsedDate = date ? isValidDate(date) : null;
    if (!parsedDate) {
      return fail(res, 'Invalid date', 400);
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) return fail(res, 'Expense not found', 404);

    // Historical lock protection: If record is from a past date, require Manager PIN
    if (isPastSettledDate(expense.date) && !checkManagerAuthorization(req)) {
      return fail(res, 'Historical records created before today are locked. Manager PIN (1959) required to edit.', 403);
    }

    expense.date = parsedDate;
    expense.amount = amount;
    expense.category = category as (typeof EXPENSE_CATEGORIES)[number];
    expense.note = note;
    expense.vendorName = vendorName;
    expense.paymentMethod = paymentMethod as (typeof EXPENSE_PAYMENT_METHODS)[number];
    await expense.save();

    return ok(res, expense, 'Expense updated');
  } catch (error) {
    next(error);
  }
};

export const getExpenses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, category, paymentMethod, includeVoid } = req.query as {
      startDate?: string;
      endDate?: string;
      category?: string;
      paymentMethod?: string;
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

    if (category && category !== 'all') {
      if (!EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
        return fail(res, 'Invalid category filter', 400);
      }
      filter.category = category;
    }

    if (paymentMethod && paymentMethod !== 'all') {
      if (!EXPENSE_PAYMENT_METHODS.includes(paymentMethod as (typeof EXPENSE_PAYMENT_METHODS)[number])) {
        return fail(res, 'Invalid paymentMethod filter', 400);
      }
      filter.paymentMethod = paymentMethod;
    }

    if (includeVoid !== 'true') {
      filter.isVoid = false;
    }

    const expenses = await Expense.find(filter).sort({ date: -1 });
    
    // Tag each record with isLocked boolean for UI convenience
    const enriched = expenses.map((e) => {
      const plain = e.toObject();
      return {
        ...plain,
        isLocked: isPastSettledDate(e.date),
      };
    });

    return ok(res, enriched);
  } catch (error) {
    next(error);
  }
};

export const getExpenseById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return fail(res, 'Expense not found', 404);
    const plain = expense.toObject();
    return ok(res, {
      ...plain,
      isLocked: isPastSettledDate(expense.date),
    });
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

    const byCategory: Record<string, number> = {};
    for (const cat of EXPENSE_CATEGORIES) {
      byCategory[cat] = 0;
    }

    const byPaymentMethod: Record<string, number> = {
      cash: 0,
      upi: 0,
      card: 0,
      bank_transfer: 0,
    };

    for (const row of byCategoryAgg) {
      const key = row._id as string;
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

// ── GET /api/expenses/hub-summary ──────────────────────────────────────────
// Dedicated live dashboard summary for Store Expense & Vendor Payables Hub
export const getExpenseHubSummary = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const todayStart = getTodayStart();
    const todayEnd = getTodayEnd();

    const [
      todayExpensesAgg,
      todayExpensesCashAgg,
      todayExpensesUpiAgg,
      todayInvoicePaymentsAgg,
      todayInvoiceCashPaymentsAgg,
      pendingVendorBills,
      recurringExpensesList,
    ] = await Promise.all([
      // Total expenses today
      Expense.aggregate([
        { $match: { date: { $gte: todayStart, $lte: todayEnd }, isVoid: false } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      // Cash expenses today
      Expense.aggregate([
        { $match: { date: { $gte: todayStart, $lte: todayEnd }, paymentMethod: 'cash', isVoid: false } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // UPI expenses today
      Expense.aggregate([
        { $match: { date: { $gte: todayStart, $lte: todayEnd }, paymentMethod: 'upi', isVoid: false } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      // Total payments received today on invoices
      Invoice.aggregate([
        { $unwind: '$payments' },
        { $match: { 'payments.date': { $gte: todayStart, $lte: todayEnd } } },
        { $group: { _id: null, total: { $sum: '$payments.amount' } } },
      ]),
      // Cash payments received today on invoices
      Invoice.aggregate([
        { $unwind: '$payments' },
        {
          $match: {
            'payments.date': { $gte: todayStart, $lte: todayEnd },
            'payments.method': { $in: ['cash', 'Cash', 'CASH'] },
          },
        },
        { $group: { _id: null, total: { $sum: '$payments.amount' } } },
      ]),
      // Unpaid vendor bills
      VendorBill.find({ status: { $ne: 'paid' } }).sort({ dueDate: 1 }),
      // Active recurring expenses
      RecurringExpense.find({ isActive: true }).sort({ nextDueDate: 1 }),
    ]);

    const todayTotalOutflow = todayExpensesAgg[0]?.total ?? 0;
    const todayExpenseCount = todayExpensesAgg[0]?.count ?? 0;
    const todayCashOutflow = todayExpensesCashAgg[0]?.total ?? 0;
    const todayUpiOutflow = todayExpensesUpiAgg[0]?.total ?? 0;

    const todayTotalInflow = todayInvoicePaymentsAgg[0]?.total ?? 0;
    const todayCashInflow = todayInvoiceCashPaymentsAgg[0]?.total ?? 0;

    // Available surplus cash in register = Cash in from counter minus Cash paid out
    const surplusCash = Math.max(0, todayCashInflow - todayCashOutflow);

    // Vendor dues pending calculations
    let totalVendorDuesPending = 0;
    let overdueVendorBillsCount = 0;
    const now = new Date();

    const pendingBillsData = pendingVendorBills.map((bill) => {
      const balance = Math.max(0, bill.totalAmount - bill.paidAmount);
      totalVendorDuesPending += balance;
      const isOverdue = bill.dueDate && new Date(bill.dueDate) < now;
      if (isOverdue) overdueVendorBillsCount += 1;
      return {
        _id: bill._id,
        vendorName: bill.vendorName,
        totalAmount: bill.totalAmount,
        paidAmount: bill.paidAmount,
        balance,
        dueDate: bill.dueDate,
        category: bill.category,
        status: bill.status,
        isOverdue,
      };
    });

    // Smart Payment Recommendation Engine
    let smartRecommendation: {
      billId: string;
      vendorName: string;
      totalDue: number;
      suggestedAmount: number;
      surplusCash: number;
      reason: string;
    } | null = null;

    if (surplusCash >= 200 && pendingBillsData.length > 0) {
      // Prioritize: 1. Overdue bills, 2. Lens Lab / Stock bills, 3. Earliest due date
      const sortedCandidates = [...pendingBillsData].sort((a, b) => {
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        const isLabA = a.vendorName.toLowerCase().includes('lab') || a.vendorName.toLowerCase().includes('lens');
        const isLabB = b.vendorName.toLowerCase().includes('lab') || b.vendorName.toLowerCase().includes('lens');
        if (isLabA && !isLabB) return -1;
        const timeA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
        const timeB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
        return timeA - timeB;
      });

      const topBill = sortedCandidates[0];
      if (topBill && topBill.balance > 0) {
        // Suggest a safe portion of surplus cash (between 30% and 60% of surplus or full balance if small)
        let suggested = Math.min(topBill.balance, Math.round((surplusCash * 0.45) / 100) * 100);
        if (suggested < 200 && topBill.balance <= surplusCash) {
          suggested = Math.min(topBill.balance, surplusCash);
        }
        if (suggested > 0) {
          smartRecommendation = {
            billId: String(topBill._id),
            vendorName: topBill.vendorName,
            totalDue: topBill.balance,
            suggestedAmount: suggested,
            surplusCash,
            reason: `Surplus cash in register is ₹${surplusCash.toLocaleString('en-IN')}. Suggested: Safe partial payout of ₹${suggested.toLocaleString('en-IN')} to ${topBill.vendorName}.`,
          };
        }
      }
    }

    // Fixed recurring bills summary
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const fixedBillsDueThisMonth = recurringExpensesList.filter((item) => {
      const due = new Date(item.nextDueDate);
      return due <= endOfMonth;
    });

    const fixedBillsPendingCount = fixedBillsDueThisMonth.length;
    const fixedBillsPendingTotal = fixedBillsDueThisMonth.reduce((sum, item) => sum + item.amount, 0);

    return ok(res, {
      today: {
        totalOutflow: todayTotalOutflow,
        cashOutflow: todayCashOutflow,
        upiOutflow: todayUpiOutflow,
        count: todayExpenseCount,
        cashInflow: todayCashInflow,
        totalInflow: todayTotalInflow,
        surplusCash,
      },
      vendorDues: {
        totalPending: totalVendorDuesPending,
        count: pendingBillsData.length,
        overdueCount: overdueVendorBillsCount,
      },
      fixedBills: {
        pendingCount: fixedBillsPendingCount,
        pendingTotal: fixedBillsPendingTotal,
      },
      smartRecommendation,
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

    // Historical lock protection
    if (isPastSettledDate(expense.date) && !checkManagerAuthorization(req)) {
      return fail(res, 'Historical records created before today are locked. Manager PIN (1959) required to void.', 403);
    }

    expense.isVoid = true;
    expense.voidReason = voidReason.trim();
    await expense.save();

    return ok(res, expense, 'Expense voided');
  } catch (error) {
    next(error);
  }
};

export const deleteExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) return fail(res, 'Expense not found', 404);

    // Historical lock protection
    if (isPastSettledDate(expense.date) && !checkManagerAuthorization(req)) {
      return fail(res, 'Historical records created before today are locked. Manager PIN (1959) required to delete.', 403);
    }

    await expense.deleteOne();
    return ok(res, { _id: req.params.id }, 'Expense deleted');
  } catch (error) {
    next(error);
  }
};
