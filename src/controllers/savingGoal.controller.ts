import { Request, Response, NextFunction } from 'express';
import { SavingGoal, SAVING_GOAL_CATEGORIES, SAVING_GOAL_STATUSES } from '../models/SavingGoal.model';
import { SavingTransaction, SAVING_TRANSACTION_TYPES } from '../models/SavingTransaction.model';
import { fail, ok } from '../utils/response';

// ── Goals ────────────────────────────────────────────────────────────────────

export const listGoals = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query as { status?: string };
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    const goals = await SavingGoal.find(filter).sort({ priority: 1, createdAt: -1 });
    res.json(goals);
  } catch (err) { next(err); }
};

export const createGoal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, category, priority, targetAmount, targetDate, notes } = req.body;
    if (!name?.trim()) return fail(res, 'name is required', 400);
    if (!category || !SAVING_GOAL_CATEGORIES.includes(category))
      return fail(res, `category must be one of: ${SAVING_GOAL_CATEGORIES.join(', ')}`, 400);
    if (typeof targetAmount !== 'number' || targetAmount <= 0)
      return fail(res, 'targetAmount must be a positive number', 400);

    const goal = await SavingGoal.create({
      name: name.trim(),
      category,
      priority: priority || 'medium',
      targetAmount,
      savedAmount: 0,
      targetDate: targetDate ? new Date(targetDate) : undefined,
      notes: notes?.trim(),
    });
    return ok(res, goal, 'Saving goal created', 201);
  } catch (err) { next(err); }
};

export const updateGoal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, category, priority, targetAmount, targetDate, status, notes } = req.body;
    const update: Record<string, unknown> = {};
    if (name?.trim()) update.name = name.trim();
    if (category) {
      if (!SAVING_GOAL_CATEGORIES.includes(category)) return fail(res, 'Invalid category', 400);
      update.category = category;
    }
    if (priority) update.priority = priority;
    if (typeof targetAmount === 'number' && targetAmount > 0) update.targetAmount = targetAmount;
    if (targetDate !== undefined) update.targetDate = targetDate ? new Date(targetDate) : null;
    if (status) {
      if (!SAVING_GOAL_STATUSES.includes(status)) return fail(res, 'Invalid status', 400);
      update.status = status;
    }
    if (notes !== undefined) update.notes = notes?.trim() || '';

    const goal = await SavingGoal.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!goal) return fail(res, 'Goal not found', 404);
    return ok(res, goal, 'Goal updated');
  } catch (err) { next(err); }
};

export const deleteGoal = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const goal = await SavingGoal.findByIdAndDelete(req.params.id);
    if (!goal) return fail(res, 'Goal not found', 404);
    await SavingTransaction.deleteMany({ goalId: req.params.id });
    return ok(res, { _id: req.params.id }, 'Goal deleted');
  } catch (err) { next(err); }
};

// ── Transactions ─────────────────────────────────────────────────────────────

export const listTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const goal = await SavingGoal.findById(req.params.id);
    if (!goal) return fail(res, 'Goal not found', 404);
    const txns = await SavingTransaction.find({ goalId: req.params.id }).sort({ date: -1 });
    res.json(txns);
  } catch (err) { next(err); }
};

export const addTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, amount, date, method, reference, notes } = req.body;
    const goal = await SavingGoal.findById(req.params.id);
    if (!goal) return fail(res, 'Goal not found', 404);
    if (!type || !SAVING_TRANSACTION_TYPES.includes(type))
      return fail(res, `type must be one of: ${SAVING_TRANSACTION_TYPES.join(', ')}`, 400);
    if (typeof amount !== 'number' || amount <= 0)
      return fail(res, 'amount must be a positive number', 400);

    const txn = await SavingTransaction.create({
      goalId: goal._id,
      type,
      amount,
      date: date ? new Date(date) : new Date(),
      method: method?.trim(),
      reference: reference?.trim(),
      notes: notes?.trim(),
    });

    // Update goal savedAmount
    if (type === 'deposit' || type === 'adjustment') {
      goal.savedAmount = Math.max(0, goal.savedAmount + amount);
    } else if (type === 'withdrawal') {
      goal.savedAmount = Math.max(0, goal.savedAmount - amount);
    }
    if (goal.savedAmount >= goal.targetAmount) goal.status = 'completed';
    await goal.save();

    return ok(res, { transaction: txn, goal }, 'Transaction recorded', 201);
  } catch (err) { next(err); }
};

export const deleteTransaction = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const txn = await SavingTransaction.findById(req.params.txnId);
    if (!txn) return fail(res, 'Transaction not found', 404);

    const goal = await SavingGoal.findById(txn.goalId);
    if (goal) {
      if (txn.type === 'deposit' || txn.type === 'adjustment') {
        goal.savedAmount = Math.max(0, goal.savedAmount - txn.amount);
      } else if (txn.type === 'withdrawal') {
        goal.savedAmount = Math.min(goal.targetAmount, goal.savedAmount + txn.amount);
      }
      if (goal.status === 'completed' && goal.savedAmount < goal.targetAmount) {
        goal.status = 'active';
      }
      await goal.save();
    }
    await txn.deleteOne();
    return ok(res, { _id: req.params.txnId }, 'Transaction deleted');
  } catch (err) { next(err); }
};
