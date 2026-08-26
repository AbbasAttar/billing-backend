import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Obligation, OBLIGATION_CATEGORIES, OBLIGATION_PRIORITIES, IObligation } from '../models/Obligation.model';
import { ObligationPayment } from '../models/ObligationPayment.model';
import { Cashflow, normalizePaymentMethod } from '../models/Cashflow.model';
import { fail, ok } from '../utils/response';

function getExpenseCategory(obl: { category?: string; subcategory?: string }): string {
  if (obl.subcategory?.trim()) return obl.subcategory.trim();
  if (obl.category === 'vendor') return 'stock';
  if (obl.category) return obl.category;
  return 'miscellaneous';
}

// ── Computed fields (never stored) ─────────────────────────────────────────────
export function computeObligation(o: IObligation, dailySurplus = 0) {
  const obj = typeof (o as { toObject?: () => unknown }).toObject === 'function'
    ? (o as { toObject: () => Record<string, unknown> }).toObject()
    : (o as unknown as Record<string, unknown>);
  const remaining = Math.max(0, (o.originalAmount ?? 0) - (o.alreadyPaid ?? 0));
  const now = new Date();

  let daysLeft: number | null = null;
  let dailyAmountNeeded: number | null = null;
  if (o.dueDate) {
    daysLeft = Math.max(0, Math.ceil((new Date(o.dueDate).getTime() - now.getTime()) / 86_400_000));
    dailyAmountNeeded = daysLeft > 0 ? remaining / daysLeft : remaining;
  }

  const paymentType: 'deadline-full' | 'recurring-minimum' =
    o.dueDate && remaining > 0 && (o.minPayment ?? 0) >= remaining ? 'deadline-full' : 'recurring-minimum';

  let riskFlag: 'URGENT' | 'AT_RISK' | 'MANAGEABLE' = 'MANAGEABLE';
  if (daysLeft === 0 && remaining > 0) {
    riskFlag = 'URGENT';
  } else if (dailyAmountNeeded !== null && dailySurplus > 0 && dailyAmountNeeded > dailySurplus * 2) {
    riskFlag = 'AT_RISK';
  } else if (dailyAmountNeeded !== null && dailySurplus === 0 && remaining > 0) {
    riskFlag = 'AT_RISK';
  }

  return {
    ...obj,
    dueDate: o.dueDate,
    creditor: o.creditor,
    category: o.category,
    status: o.status,
    originalAmount: o.originalAmount,
    alreadyPaid: o.alreadyPaid,
    priority: o.priority,
    isRecurring: o.isRecurring ?? false,
    dueDay: o.dueDay,
    remaining,
    daysLeft,
    dailyAmountNeeded: dailyAmountNeeded !== null ? Math.ceil(dailyAmountNeeded) : null,
    paymentType,
    riskFlag,
  };
}

// ── List ───────────────────────────────────────────────────────────────────────
export const listObligations = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, status } = req.query as { category?: string; status?: string };
    const filter: Record<string, unknown> = {};
    if (category && OBLIGATION_CATEGORIES.includes(category as typeof OBLIGATION_CATEGORIES[number])) filter.category = category;
    if (status) filter.status = status;

    const obligations = await Obligation.find(filter).sort({ priority: 1, dueDate: 1, createdAt: -1 });
    return ok(res, obligations.map((o) => computeObligation(o)));
  } catch (err) { next(err); }
};

// ── Create ─────────────────────────────────────────────────────────────────────
export const createObligation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { creditor, category, subcategory, originalAmount, alreadyPaid, priority, dueDate, billDate, minPayment, isRecurring, dueDay, notes, status, items } = req.body;

    if (!creditor?.trim()) return fail(res, 'creditor is required', 400);
    if (typeof originalAmount !== 'number' || originalAmount < 0) return fail(res, 'originalAmount must be >= 0', 400);
    if (category && !OBLIGATION_CATEGORIES.includes(category)) return fail(res, `category must be one of: ${OBLIGATION_CATEGORIES.join(', ')}`, 400);
    if (priority && !OBLIGATION_PRIORITIES.includes(priority)) return fail(res, `priority must be one of: ${OBLIGATION_PRIORITIES.join(', ')}`, 400);

    let resolvedDueDate: Date | undefined = dueDate ? new Date(dueDate) : undefined;
    if (isRecurring && dueDay && !dueDate) {
      const n = new Date();
      const thisMonth = new Date(n.getFullYear(), n.getMonth(), dueDay);
      resolvedDueDate = thisMonth <= n
        ? new Date(n.getFullYear(), n.getMonth() + 1, dueDay)
        : thisMonth;
    }

    const obl = await Obligation.create({
      creditor: creditor.trim(),
      category: category ?? 'other',
      subcategory: subcategory?.trim(),
      originalAmount,
      alreadyPaid: alreadyPaid ?? 0,
      priority: priority ?? '3-normal',
      dueDate: resolvedDueDate,
      billDate: billDate ? new Date(billDate) : undefined,
      minPayment: minPayment ?? 0,
      isRecurring: isRecurring ?? false,
      dueDay: dueDay ?? undefined,
      notes: notes?.trim(),
      status: status ?? (alreadyPaid >= originalAmount && originalAmount > 0 ? 'paid' : 'open'),
      items: Array.isArray(items) ? items : [],
    });

    if (alreadyPaid && alreadyPaid > 0) {
      const paymentDate = billDate ? new Date(billDate) : new Date();
      const paymentNotes = notes?.trim() ? `Initial payment: ${notes.trim()}` : `Initial payment`;
      const payment = await ObligationPayment.create({
        obligationId: obl._id,
        creditor: obl.creditor,
        amountPaid: alreadyPaid,
        date: paymentDate,
        method: 'cash',
        notes: paymentNotes,
      });

      const expenseCategory = getExpenseCategory(obl);
      await Cashflow.create({
        type: 'expense',
        date: paymentDate,
        amount: alreadyPaid,
        paidAmount: alreadyPaid,
        status: 'logged',
        category: expenseCategory,
        vendorName: obl.creditor,
        note: `${paymentNotes} (${obl.creditor})`,
        paymentMethod: 'cash',
        items: [],
        payments: [
          {
            amount: alreadyPaid,
            date: paymentDate,
            method: 'cash',
            note: paymentNotes,
          },
        ],
        obligationId: obl._id,
        obligationPaymentId: payment._id,
      });
    }

    return ok(res, computeObligation(obl), 'Created', 201);
  } catch (err) { next(err); }
};

// ── Update ─────────────────────────────────────────────────────────────────────
export const updateObligation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['creditor', 'category', 'subcategory', 'originalAmount', 'alreadyPaid', 'priority', 'dueDate', 'billDate', 'minPayment', 'isRecurring', 'dueDay', 'notes', 'status', 'items'];
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.dueDate !== undefined) update.dueDate = update.dueDate ? new Date(update.dueDate as string) : null;
    if (update.billDate !== undefined) update.billDate = update.billDate ? new Date(update.billDate as string) : null;

    const obl = await Obligation.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!obl) return fail(res, 'Not found', 404);

    // Sync updated creditor name or category to linked Cashflow entries
    const category = getExpenseCategory(obl);
    await Cashflow.updateMany(
      { obligationId: obl._id, status: { $ne: 'void' } },
      { $set: { vendorName: obl.creditor, category } }
    );

    return ok(res, computeObligation(obl), 'Updated');
  } catch (err) { next(err); }
};

// ── Delete ─────────────────────────────────────────────────────────────────────
export const deleteObligation = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const obl = await Obligation.findByIdAndDelete(req.params.id);
    if (!obl) return fail(res, 'Not found', 404);
    await ObligationPayment.deleteMany({ obligationId: new mongoose.Types.ObjectId(req.params.id as string) });
    await Cashflow.deleteMany({ obligationId: new mongoose.Types.ObjectId(req.params.id as string) });
    return ok(res, { _id: req.params.id }, 'Deleted');
  } catch (err) { next(err); }
};

// ── Record Payment ─────────────────────────────────────────────────────────────
export const recordPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const obl = await Obligation.findById(req.params.id);
    if (!obl) return fail(res, 'Obligation not found', 404);
    if (obl.status === 'paid') return fail(res, 'Already fully paid', 400);

    const { amountPaid, date, method, notes } = req.body;
    if (typeof amountPaid !== 'number' || amountPaid <= 0) return fail(res, 'amountPaid must be > 0', 400);

    const paymentDate = date ? new Date(date) : new Date();
    const paymentMethod = normalizePaymentMethod(method);
    const paymentNotes = notes?.trim();

    const payment = await ObligationPayment.create({
      obligationId: obl._id,
      creditor: obl.creditor,
      amountPaid,
      date: paymentDate,
      method: paymentMethod,
      notes: paymentNotes,
    });

    obl.alreadyPaid = Math.min(obl.alreadyPaid + amountPaid, obl.originalAmount);
    if (obl.alreadyPaid >= obl.originalAmount) {
      if (obl.isRecurring) {
        // Reset balance and advance due date to next month's cycle
        obl.alreadyPaid = 0;
        if (obl.dueDate) {
          const next = new Date(obl.dueDate);
          next.setMonth(next.getMonth() + 1);
          obl.dueDate = next;
        } else if (obl.dueDay) {
          const n = new Date();
          obl.dueDate = new Date(n.getFullYear(), n.getMonth() + 1, obl.dueDay);
        }
      } else {
        obl.status = 'paid';
      }
    }
    await obl.save();

    // Determine expense category and note
    const expenseCategory = getExpenseCategory(obl);
    const note = paymentNotes
      ? `${paymentNotes} (${obl.creditor})`
      : `Payment for ${obl.category}: ${obl.creditor}`;

    // Create corresponding Cashflow expense entry
    await Cashflow.create({
      type: 'expense',
      date: paymentDate,
      amount: amountPaid,
      paidAmount: amountPaid,
      status: 'logged',
      category: expenseCategory,
      vendorName: obl.creditor,
      note,
      paymentMethod,
      items: [],
      payments: [
        {
          amount: amountPaid,
          date: paymentDate,
          method: paymentMethod,
          note: paymentNotes,
        },
      ],
      obligationId: obl._id,
      obligationPaymentId: payment._id,
    });

    return ok(res, { obligation: computeObligation(obl), payment }, 'Payment recorded', 201);
  } catch (err) { next(err); }
};
