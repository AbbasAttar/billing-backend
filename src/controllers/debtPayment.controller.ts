import { Request, Response, NextFunction } from 'express';
import { DebtPayment } from '../models/DebtPayment.model';
import { Debt } from '../models/Debt.model';
import { fail, ok } from '../utils/response';

export const listPayments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { debtId } = req.query as { debtId?: string };
    const filter: Record<string, unknown> = {};
    if (debtId) filter.debtId = debtId;
    const payments = await DebtPayment.find(filter).sort({ date: -1 });
    res.json(payments);
  } catch (err) { next(err); }
};

export const createPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { debtId, creditor, amountPaid, date, notes } = req.body;

    if (!debtId?.trim()) return fail(res, 'debtId is required', 400);
    if (!creditor?.trim()) return fail(res, 'creditor is required', 400);
    if (typeof amountPaid !== 'number' || amountPaid <= 0) return fail(res, 'amountPaid must be positive', 400);

    const payment = await DebtPayment.create({
      date: date ? new Date(date) : new Date(),
      debtId: debtId.trim(),
      creditor: creditor.trim(),
      amountPaid,
      notes: notes?.trim(),
    });

    // Update debt's alreadyPaid and auto-close if fully paid
    const debt = await Debt.findOne({ debtId: debtId.trim() });
    if (debt) {
      debt.alreadyPaid = (debt.alreadyPaid ?? 0) + amountPaid;
      if (debt.alreadyPaid >= debt.originalAmount) {
        debt.status = 'paid';
      }
      await debt.save();
    }

    return ok(res, payment, 'Payment recorded', 201);
  } catch (err) { next(err); }
};

export const deletePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payment = await DebtPayment.findByIdAndDelete(req.params.id);
    if (!payment) return fail(res, 'Payment not found', 404);

    // Reverse the alreadyPaid on the debt
    const debt = await Debt.findOne({ debtId: payment.debtId });
    if (debt) {
      debt.alreadyPaid = Math.max(0, (debt.alreadyPaid ?? 0) - payment.amountPaid);
      if (debt.status === 'paid' && debt.alreadyPaid < debt.originalAmount) {
        debt.status = 'open';
      }
      await debt.save();
    }

    return ok(res, { _id: req.params.id }, 'Deleted');
  } catch (err) { next(err); }
};
