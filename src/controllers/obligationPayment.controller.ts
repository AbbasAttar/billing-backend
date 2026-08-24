import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { ObligationPayment } from '../models/ObligationPayment.model';
import { Obligation } from '../models/Obligation.model';
import { computeObligation } from './obligation.controller';
import { fail, ok } from '../utils/response';

export const listPayments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { obligationId } = req.query as { obligationId?: string };
    const filter: Record<string, unknown> = {};
    if (obligationId) filter.obligationId = new mongoose.Types.ObjectId(obligationId);
    const payments = await ObligationPayment.find(filter).sort({ date: -1 }).limit(200);
    return ok(res, payments);
  } catch (err) { next(err); }
};

export const deletePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payment = await ObligationPayment.findByIdAndDelete(req.params.id);
    if (!payment) return fail(res, 'Payment not found', 404);

    const obl = await Obligation.findById(payment.obligationId);
    if (obl) {
      obl.alreadyPaid = Math.max(0, obl.alreadyPaid - payment.amountPaid);
      if (obl.status === 'paid' && obl.alreadyPaid < obl.originalAmount) obl.status = 'open';
      await obl.save();
      return ok(res, { payment: { _id: req.params.id }, obligation: computeObligation(obl) }, 'Deleted');
    }
    return ok(res, { payment: { _id: req.params.id } }, 'Deleted');
  } catch (err) { next(err); }
};
