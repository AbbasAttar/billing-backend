import { Request, Response, NextFunction } from 'express';
import { Debt, DEBT_PAYMENT_TYPES } from '../models/Debt.model';
import { Commitment } from '../models/Commitment.model';
import { DebtConfig } from '../models/DebtConfig.model';
import { fail, ok } from '../utils/response';

export const listDebts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query as { status?: string };
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    const debts = await Debt.find(filter).sort({ priority: 1, dueDate: 1 });
    const result = debts.map((d) => ({ ...d.toObject(), remaining: Math.max(0, d.originalAmount - d.alreadyPaid) }));
    res.json(result);
  } catch (err) { next(err); }
};

export const createDebt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { debtId, creditor, originalAmount, alreadyPaid, priority, dueDate, minimumPayment, notes, status, paymentType } = req.body;

    if (!creditor?.trim()) return fail(res, 'creditor is required', 400);
    if (typeof originalAmount !== 'number' || originalAmount < 0) return fail(res, 'originalAmount must be >= 0', 400);
    if (typeof minimumPayment !== 'number' || minimumPayment < 0) return fail(res, 'minimumPayment must be >= 0', 400);
    if (!DEBT_PAYMENT_TYPES.includes(paymentType)) return fail(res, `paymentType must be one of: ${DEBT_PAYMENT_TYPES.join(', ')}`, 400);

    let resolvedId = debtId?.trim();
    if (!resolvedId) {
      const count = await Debt.countDocuments();
      resolvedId = `D${String(count + 1).padStart(3, '0')}`;
    }

    const debt = await Debt.create({
      debtId: resolvedId,
      creditor: creditor.trim(),
      originalAmount,
      alreadyPaid: alreadyPaid ?? 0,
      priority: priority ?? '3-normal',
      dueDate: dueDate ? new Date(dueDate) : undefined,
      minimumPayment,
      notes: notes?.trim(),
      status: status ?? 'open',
      paymentType,
    });
    return ok(res, { ...debt.toObject(), remaining: Math.max(0, debt.originalAmount - debt.alreadyPaid) }, 'Debt created', 201);
  } catch (err) { next(err); }
};

export const updateDebt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allowed = ['creditor', 'originalAmount', 'alreadyPaid', 'priority', 'dueDate', 'minimumPayment', 'notes', 'status', 'paymentType'];
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.dueDate !== undefined) {
      update.dueDate = update.dueDate ? new Date(update.dueDate as string) : null;
    }
    const debt = await Debt.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!debt) return fail(res, 'Debt not found', 404);
    return ok(res, { ...debt.toObject(), remaining: Math.max(0, debt.originalAmount - debt.alreadyPaid) }, 'Updated');
  } catch (err) { next(err); }
};

export const deleteDebt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const debt = await Debt.findByIdAndDelete(req.params.id);
    if (!debt) return fail(res, 'Debt not found', 404);
    return ok(res, { _id: req.params.id }, 'Deleted');
  } catch (err) { next(err); }
};

export const getDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [debts, commitments, config] = await Promise.all([
      Debt.find().sort({ priority: 1, dueDate: 1 }),
      Commitment.find().sort({ name: 1 }),
      DebtConfig.findOne(),
    ]);

    const cfg = config ?? { expectedShopIncome: 0, otherIncome: 0, safetyBuffer: 0 };

    const openDebts = debts.filter((d) => d.status === 'open');
    const totalDebtRemaining = openDebts.reduce((s, d) => s + Math.max(0, d.originalAmount - d.alreadyPaid), 0);
    const monthlyFixedCommitments = commitments.reduce((s, c) => s + c.amount, 0);
    const recurringDebtMinimums = openDebts
      .filter((d) => d.paymentType === 'recurring-minimum')
      .reduce((s, d) => s + d.minimumPayment, 0);
    const totalIncome = cfg.expectedShopIncome + cfg.otherIncome;
    const monthlyBaselineNeed = monthlyFixedCommitments + recurringDebtMinimums + cfg.safetyBuffer;
    const monthlyShortfall = totalIncome - monthlyBaselineNeed;
    const safeExtraRepaymentCapacity = Math.max(0, monthlyShortfall);

    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyBaselineNeed = daysInMonth > 0 ? monthlyBaselineNeed / daysInMonth : 0;
    const dailyIncome = daysInMonth > 0 ? totalIncome / daysInMonth : 0;
    const dailySurplus = Math.max(0, dailyIncome - dailyBaselineNeed);

    const deadlineDebts = openDebts
      .filter((d) => d.paymentType === 'deadline-full' && d.dueDate)
      .map((d) => {
        const remaining = Math.max(0, d.originalAmount - d.alreadyPaid);
        const daysLeft = Math.max(0, Math.ceil((d.dueDate!.getTime() - now.getTime()) / 86_400_000));
        const dailyAmountNeeded = daysLeft > 0 ? remaining / daysLeft : remaining;
        const isAtRisk = dailyAmountNeeded > dailySurplus || daysLeft === 0;
        return {
          _id: d._id,
          debtId: d.debtId,
          creditor: d.creditor,
          remaining,
          dueDate: d.dueDate,
          daysLeft,
          dailyAmountNeeded: Math.ceil(dailyAmountNeeded),
          isAtRisk,
        };
      });

    return ok(res, {
      totalDebtRemaining,
      monthlyFixedCommitments,
      recurringDebtMinimums,
      totalIncome,
      safetyBuffer: cfg.safetyBuffer,
      monthlyBaselineNeed,
      monthlyShortfall,
      safeExtraRepaymentCapacity,
      openDebtCount: openDebts.length,
      deadlineDebtCount: deadlineDebts.length,
      daysInMonth,
      dailyBaselineNeed: Math.round(dailyBaselineNeed),
      dailyIncome: Math.round(dailyIncome),
      dailySurplus: Math.round(dailySurplus),
      recommendedDailySavings: Math.round(dailySurplus * 0.75),
      deadlineDebts,
      debts: debts.map((d) => ({ ...d.toObject(), remaining: Math.max(0, d.originalAmount - d.alreadyPaid) })),
      commitments,
    });
  } catch (err) { next(err); }
};
