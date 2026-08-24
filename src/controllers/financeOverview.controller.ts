import { Request, Response, NextFunction } from 'express';
import { Obligation } from '../models/Obligation.model';
import { Commitment } from '../models/Commitment.model';
import { DebtConfig } from '../models/DebtConfig.model';
import { RecurringExpense } from '../models/RecurringExpense.model';
import { SavingGoal } from '../models/SavingGoal.model';
import { MonthlyTarget } from '../models/MonthlyTarget.model';
import { Cashflow } from '../models/Cashflow.model';
import { Invoice } from '../models/Invoice.model';
import { computeObligation } from './obligation.controller';
import { ok } from '../utils/response';

const FREQ_TO_MONTHLY: Record<string, number> = {
  daily: 30, weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12,
};
function recurringMonthlyTotal(items: { amount: number; frequency: string; isActive: boolean }[]): number {
  return items
    .filter((r) => r.isActive)
    .reduce((s, r) => s + r.amount * (FREQ_TO_MONTHLY[r.frequency] ?? 1), 0);
}

// ── Dashboard (replaces getDashboard from debt.controller) ────────────────────
export const getFinanceDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [obligations, commitments, config, activeRecurring, invoiceIncomeRaw, cashflowFixedRaw] = await Promise.all([
      Obligation.find({ status: 'open' }).sort({ priority: 1, dueDate: 1 }),
      Commitment.find().sort({ name: 1 }),
      DebtConfig.findOne(),
      RecurringExpense.find({ isActive: true }),
      Invoice.aggregate([
        { $unwind: '$payments' },
        { $match: { 'payments.date': { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$payments.amount' } } },
      ]),
      Cashflow.aggregate([
        { $match: {
          type: 'expense', date: { $gte: monthStart }, status: { $ne: 'void' },
          category: { $in: ['rent', 'salary', 'utilities', 'maintenance'] },
        }},
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const cfg = config ?? { expectedShopIncome: 0, otherIncome: 0, safetyBuffer: 0 };
    const manualIncome = cfg.expectedShopIncome + cfg.otherIncome;
    const totalIncome = manualIncome > 0 ? manualIncome : (invoiceIncomeRaw[0]?.total ?? 0);

    const manualCommitments = commitments.reduce((s, c) => s + c.amount, 0);
    const recurringFixed = recurringMonthlyTotal(activeRecurring);
    const recurringObligationMonthly = obligations
      .filter((o) => o.isRecurring)
      .reduce((s, o) => s + o.originalAmount, 0);
    const combinedCommitments = manualCommitments + recurringFixed + recurringObligationMonthly;
    const monthlyFixedCommitments = combinedCommitments > 0 ? combinedCommitments : (cashflowFixedRaw[0]?.total ?? 0);

    const recurringMin = obligations
      .filter((o) => o.minPayment > 0 && !o.isRecurring)
      .reduce((s, o) => s + o.minPayment, 0);

    const monthlyBaselineNeed = monthlyFixedCommitments + recurringMin + cfg.safetyBuffer;
    const monthlyShortfall = totalIncome - monthlyBaselineNeed;

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyIncome = daysInMonth > 0 ? totalIncome / daysInMonth : 0;
    const dailyBaselineNeed = daysInMonth > 0 ? monthlyBaselineNeed / daysInMonth : 0;
    const dailySurplus = Math.max(0, dailyIncome - dailyBaselineNeed);

    const totalObligationRemaining = obligations.reduce(
      (s, o) => s + Math.max(0, o.originalAmount - o.alreadyPaid), 0
    );

    const computed = obligations.map((o) => computeObligation(o, dailySurplus));
    const deadlineRisks = computed.filter(
      (o) => o.dueDate && (o.riskFlag === 'URGENT' || o.riskFlag === 'AT_RISK')
    );

    return ok(res, {
      totalObligationRemaining,
      monthlyFixedCommitments,
      recurringObligationMinimums: recurringMin,
      totalIncome,
      safetyBuffer: cfg.safetyBuffer,
      monthlyBaselineNeed,
      monthlyShortfall,
      safeExtraRepaymentCapacity: Math.max(0, monthlyShortfall),
      openCount: obligations.length,
      daysInMonth,
      dailyBaselineNeed: Math.round(dailyBaselineNeed),
      dailyIncome: Math.round(dailyIncome),
      dailySurplus: Math.round(dailySurplus),
      recommendedDailySavings: Math.round(dailySurplus * 0.75),
      deadlineRisks,
      obligations: computed,
      commitments,
    });
  } catch (err) { next(err); }
};

// ── Monthly Plan (config + income suggestion) ─────────────────────────────────
export const getMonthlyPlan = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [config, income30dRaw, income7dRaw] = await Promise.all([
      DebtConfig.findOne(),
      // Invoice collections last 30 days
      (async () => {
        const from = new Date(); from.setDate(from.getDate() - 30);
        const rows = await Invoice.aggregate([
          { $unwind: '$payments' },
          { $match: { 'payments.date': { $gte: from } } },
          { $group: { _id: null, total: { $sum: '$payments.amount' } } },
        ]);
        return rows[0]?.total ?? 0;
      })(),
      // Invoice collections last 7 days
      (async () => {
        const from = new Date(); from.setDate(from.getDate() - 7);
        const rows = await Invoice.aggregate([
          { $unwind: '$payments' },
          { $match: { 'payments.date': { $gte: from } } },
          { $group: { _id: null, total: { $sum: '$payments.amount' } } },
        ]);
        return rows[0]?.total ?? 0;
      })(),
    ]);

    const avg30d = income30dRaw;                     // monthly total (last 30 days)
    const avg7dMonthly = (income7dRaw / 7) * 30;    // extrapolate 7-day to monthly
    const conservativeSuggestion = Math.min(avg30d, avg7dMonthly);

    const stored = config ?? { expectedShopIncome: 0, otherIncome: 0, safetyBuffer: 0 };
    return ok(res, {
      stored: {
        expectedShopIncome: stored.expectedShopIncome,
        otherIncome: stored.otherIncome,
        safetyBuffer: stored.safetyBuffer,
      },
      suggestion: {
        income30dTotal: Math.round(avg30d),
        income7dMonthlyEquiv: Math.round(avg7dMonthly),
        conservative: Math.round(conservativeSuggestion),
      },
    });
  } catch (err) { next(err); }
};

export const saveMonthlyPlan = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { expectedShopIncome, otherIncome, safetyBuffer } = req.body;
    const update: Record<string, number> = {};
    if (typeof expectedShopIncome === 'number') update.expectedShopIncome = Math.max(0, expectedShopIncome);
    if (typeof otherIncome === 'number') update.otherIncome = Math.max(0, otherIncome);
    if (typeof safetyBuffer === 'number') update.safetyBuffer = Math.max(0, safetyBuffer);

    const config = await DebtConfig.findOneAndUpdate({}, { $set: update }, { new: true, upsert: true });
    return ok(res, config, 'Saved');
  } catch (err) { next(err); }
};

// ── Attention Needed ──────────────────────────────────────────────────────────
type AttentionSeverity = 'critical' | 'warning' | 'info';
interface AttentionItem {
  id: string;
  type: 'obligation_urgent' | 'obligation_at_risk' | 'recurring_due' | 'goal_behind' | 'budget_overrun' | 'shortfall';
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href: string;
}

export const getAttentionNeeded = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [obligations, commitments, config, recurringDue, activeRecurring, activeGoals, monthlyTarget, mtdExpenseRaw, invoiceIncomeRaw, cashflowFixedRaw] = await Promise.all([
      Obligation.find({ status: 'open' }),
      Commitment.find(),
      DebtConfig.findOne(),
      RecurringExpense.find({
        isActive: true,
        nextDueDate: { $lte: new Date(Date.now() + 5 * 86_400_000) },
      }),
      RecurringExpense.find({ isActive: true }),
      SavingGoal.find({ status: 'active', targetDate: { $exists: true, $ne: null } }),
      MonthlyTarget.findOne({ month: monthKey }),
      Cashflow.aggregate([
        { $match: { type: 'expense', date: { $gte: monthStart }, status: { $ne: 'void' } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Invoice.aggregate([
        { $unwind: '$payments' },
        { $match: { 'payments.date': { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$payments.amount' } } },
      ]),
      Cashflow.aggregate([
        { $match: {
          type: 'expense', date: { $gte: monthStart }, status: { $ne: 'void' },
          category: { $in: ['rent', 'salary', 'utilities', 'maintenance'] },
        }},
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const cfg = config ?? { expectedShopIncome: 0, otherIncome: 0, safetyBuffer: 0 };
    const manualIncome = cfg.expectedShopIncome + cfg.otherIncome;
    const totalIncome = manualIncome > 0 ? manualIncome : (invoiceIncomeRaw[0]?.total ?? 0);
    const manualCommitments = commitments.reduce((s, c) => s + c.amount, 0);
    const recurringFixed = recurringMonthlyTotal(activeRecurring);
    const recurringObligationMonthly = obligations
      .filter((o) => o.isRecurring)
      .reduce((s, o) => s + o.originalAmount, 0);
    const combinedCommitments = manualCommitments + recurringFixed + recurringObligationMonthly;
    const monthlyFixedCommitments = combinedCommitments > 0 ? combinedCommitments : (cashflowFixedRaw[0]?.total ?? 0);
    const recurringMin = obligations.filter((o) => o.minPayment > 0 && !o.isRecurring).reduce((s, o) => s + o.minPayment, 0);
    const monthlyBaselineNeed = monthlyFixedCommitments + recurringMin + cfg.safetyBuffer;

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyIncome = daysInMonth > 0 ? totalIncome / daysInMonth : 0;
    const dailyBaselineNeed = daysInMonth > 0 ? monthlyBaselineNeed / daysInMonth : 0;
    const dailySurplus = Math.max(0, dailyIncome - dailyBaselineNeed);

    const items: AttentionItem[] = [];

    // Shortfall
    if (totalIncome > 0 && monthlyBaselineNeed > totalIncome) {
      items.push({
        id: 'shortfall',
        type: 'shortfall',
        severity: 'critical',
        title: 'Monthly shortfall detected',
        detail: `Baseline need ₹${Math.round(monthlyBaselineNeed).toLocaleString()} exceeds income ₹${Math.round(totalIncome).toLocaleString()}`,
        href: '/finance/overview',
      });
    }

    // Obligations
    for (const o of obligations) {
      const computed = computeObligation(o, dailySurplus);
      if (computed.riskFlag === 'URGENT') {
        items.push({
          id: String(o._id),
          type: 'obligation_urgent',
          severity: 'critical',
          title: `${o.creditor} — due today`,
          detail: `₹${computed.remaining.toLocaleString()} remaining`,
          href: '/finance/obligations',
        });
      } else if (computed.riskFlag === 'AT_RISK') {
        items.push({
          id: String(o._id),
          type: 'obligation_at_risk',
          severity: 'warning',
          title: `${o.creditor} — at risk`,
          detail: `Needs ₹${computed.dailyAmountNeeded?.toLocaleString() ?? 0}/day, surplus is ₹${Math.round(dailySurplus).toLocaleString()}/day`,
          href: '/finance/obligations',
        });
      }
    }

    // Recurring due
    for (const r of recurringDue) {
      const isPast = r.nextDueDate < now;
      items.push({
        id: String(r._id),
        type: 'recurring_due',
        severity: isPast ? 'critical' : 'warning',
        title: `${r.name} ${isPast ? 'overdue' : 'due soon'}`,
        detail: `₹${r.amount.toLocaleString()} — ${isPast ? 'was due' : 'due'} ${r.nextDueDate.toLocaleDateString()}`,
        href: '/finance/cashflow/expenses',
      });
    }

    // Saving goals behind pace
    for (const g of activeGoals) {
      if (!g.targetDate) continue;
      const daysLeft = Math.max(0, Math.ceil((g.targetDate.getTime() - now.getTime()) / 86_400_000));
      const remaining = Math.max(0, g.targetAmount - g.savedAmount);
      if (daysLeft === 0) continue;
      const dailyNeeded = remaining / daysLeft;
      const expectedSaved = g.savedAmount + dailyNeeded * (new Date(now).getDate());
      if (g.savedAmount < expectedSaved * 0.8) {
        items.push({
          id: String(g._id),
          type: 'goal_behind',
          severity: 'info',
          title: `Goal "${g.name}" behind pace`,
          detail: `₹${Math.round(remaining).toLocaleString()} left, ${daysLeft} days`,
          href: '/finance/savings',
        });
      }
    }

    // Budget overrun
    if (monthlyTarget && mtdExpenseRaw[0]?.total > monthlyTarget.expenseBudget) {
      items.push({
        id: 'budget-overrun',
        type: 'budget_overrun',
        severity: 'warning',
        title: 'Expense budget exceeded',
        detail: `Spent ₹${Math.round(mtdExpenseRaw[0].total).toLocaleString()} of ₹${monthlyTarget.expenseBudget.toLocaleString()} budget`,
        href: '/finance/cashflow/expenses',
      });
    }

    // Sort: critical first, then warning, then info
    const order: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };
    items.sort((a, b) => order[a.severity] - order[b.severity]);

    return ok(res, { items, count: items.length });
  } catch (err) { next(err); }
};
