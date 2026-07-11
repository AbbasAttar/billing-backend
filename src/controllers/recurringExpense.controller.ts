import { Request, Response, NextFunction } from 'express';
import { RecurringExpense, RECURRING_FREQUENCIES } from '../models/RecurringExpense.model';
import { Cashflow } from '../models/Cashflow.model';
import { fail, ok } from '../utils/response';

const computeNextDueDate = (frequency: string, fromDate: Date, dayOfMonth?: number): Date => {
  const next = new Date(fromDate);
  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      if (dayOfMonth) next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      break;
    case 'quarterly':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  next.setHours(0, 0, 0, 0);
  return next;
};

export const listRecurring = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { isActive } = req.query as { isActive?: string };
    const filter: Record<string, unknown> = {};
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    const items = await RecurringExpense.find(filter).sort({ nextDueDate: 1 });
    res.json(items);
  } catch (err) { next(err); }
};

export const createRecurring = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      name, category, amount, frequency, dayOfMonth, nextDueDate,
      reminderDays, autoGenerate, autoMarkPaid, paymentMethod, vendorName, notes,
    } = req.body;

    if (!name?.trim()) return fail(res, 'name is required', 400);
    if (!category?.trim()) return fail(res, 'category is required', 400);
    if (typeof amount !== 'number' || amount <= 0) return fail(res, 'amount must be positive', 400);
    if (!frequency || !RECURRING_FREQUENCIES.includes(frequency))
      return fail(res, `frequency must be one of: ${RECURRING_FREQUENCIES.join(', ')}`, 400);

    const dueDate = nextDueDate ? new Date(nextDueDate) : new Date();
    dueDate.setHours(0, 0, 0, 0);

    const item = await RecurringExpense.create({
      name: name.trim(),
      category: category.trim(),
      amount,
      frequency,
      dayOfMonth: dayOfMonth ?? undefined,
      nextDueDate: dueDate,
      reminderDays: reminderDays ?? 3,
      autoGenerate: autoGenerate ?? false,
      autoMarkPaid: autoMarkPaid ?? false,
      paymentMethod: paymentMethod?.trim(),
      vendorName: vendorName?.trim(),
      notes: notes?.trim(),
      isActive: true,
      deposits: [],
      prepaidAmount: 0,
    });
    return ok(res, item, 'Recurring expense created', 201);
  } catch (err) { next(err); }
};

export const updateRecurring = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = [
      'name', 'category', 'amount', 'frequency', 'dayOfMonth', 'nextDueDate',
      'reminderDays', 'autoGenerate', 'autoMarkPaid', 'paymentMethod', 'vendorName', 'notes', 'isActive',
    ];
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.nextDueDate) {
      const d = new Date(update.nextDueDate as string);
      d.setHours(0, 0, 0, 0);
      update.nextDueDate = d;
    }
    const item = await RecurringExpense.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!item) return fail(res, 'Recurring expense not found', 404);
    return ok(res, item, 'Updated');
  } catch (err) { next(err); }
};

export const deleteRecurring = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await RecurringExpense.findByIdAndDelete(req.params.id);
    if (!item) return fail(res, 'Recurring expense not found', 404);
    return ok(res, { _id: req.params.id }, 'Deleted');
  } catch (err) { next(err); }
};

// POST /api/recurring-expenses/generate
// Creates cashflow expense entries for all overdue/due-today recurring items
export const generateDueEntries = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const dueItems = await RecurringExpense.find({ isActive: true, nextDueDate: { $lte: today } });
    const created: unknown[] = [];

    for (const item of dueItems) {
      const appliedPrepaid = Math.min(item.prepaidAmount, item.amount);
      const payments: { amount: number; date: Date; method: string; note?: string }[] = [];

      if (item.autoMarkPaid) {
        payments.push({ amount: item.amount, date: item.nextDueDate, method: item.paymentMethod || 'cash' });
      } else if (appliedPrepaid > 0) {
        payments.push({ amount: appliedPrepaid, date: item.nextDueDate, method: 'prepaid', note: 'Applied from advance deposits' });
      }

      const expense = await Cashflow.create({
        type: 'expense',
        date: item.nextDueDate,
        amount: item.amount,
        paidAmount: item.autoMarkPaid ? item.amount : appliedPrepaid,
        status: 'logged',
        category: item.category,
        vendorName: item.vendorName,
        note: `Auto-generated from recurring: ${item.name}`,
        paymentMethod: item.paymentMethod || 'cash',
        items: [],
        payments,
      });
      created.push(expense);

      // Clear applied prepaid deposits and advance the schedule
      item.prepaidAmount = Math.max(0, item.prepaidAmount - appliedPrepaid);
      if (appliedPrepaid > 0) item.deposits = [];
      item.nextDueDate = computeNextDueDate(item.frequency, item.nextDueDate, item.dayOfMonth);
      await item.save();
    }

    return ok(res, { created: created.length, entries: created }, `Generated ${created.length} expense entries`);
  } catch (err) { next(err); }
};

// GET /api/recurring-expenses/due-soon  — items due within reminderDays
export const getDueSoon = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await RecurringExpense.find({ isActive: true }).sort({ nextDueDate: 1 });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueSoon = items.filter((item) => {
      const daysUntilDue = Math.ceil((item.nextDueDate.getTime() - today.getTime()) / 86_400_000);
      return daysUntilDue <= item.reminderDays;
    });

    res.json(dueSoon);
  } catch (err) { next(err); }
};

// POST /api/recurring-expenses/:id/deposits
export const addDeposit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { amount, method, date, note } = req.body;
    if (typeof amount !== 'number' || amount <= 0) return fail(res, 'amount must be positive', 400);

    const item = await RecurringExpense.findById(req.params.id);
    if (!item) return fail(res, 'Recurring expense not found', 404);

    item.deposits.push({ amount, method, date: date ? new Date(date) : new Date(), note } as any);
    item.prepaidAmount = (item.prepaidAmount || 0) + amount;
    await item.save();
    return ok(res, item, 'Deposit recorded');
  } catch (err) { next(err); }
};

// DELETE /api/recurring-expenses/:id/deposits/:depositId
export const deleteDeposit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await RecurringExpense.findById(req.params.id);
    if (!item) return fail(res, 'Recurring expense not found', 404);

    const deposit = item.deposits.find((d) => String(d._id) === req.params.depositId);
    if (!deposit) return fail(res, 'Deposit not found', 404);

    item.prepaidAmount = Math.max(0, (item.prepaidAmount || 0) - deposit.amount);
    item.deposits = item.deposits.filter((d) => String(d._id) !== req.params.depositId);
    await item.save();
    return ok(res, item, 'Deposit removed');
  } catch (err) { next(err); }
};
