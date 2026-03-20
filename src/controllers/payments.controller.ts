import { NextFunction, Request, Response } from 'express';
import { Invoice } from '../models/Invoice.model';
import { ok } from '../utils/response';

type AgingBucket = '0-7' | '8-30' | '31-60' | '61-90' | '90+';

const getAgingBucket = (daysPending: number): AgingBucket => {
  if (daysPending <= 7) return '0-7';
  if (daysPending <= 30) return '8-30';
  if (daysPending <= 60) return '31-60';
  if (daysPending <= 90) return '61-90';
  return '90+';
};

export const getPendingPayments = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const invoices = await Invoice.find({ billClearDate: null })
      .sort({ billDate: 1 })
      .populate('customer', 'name mobileNumber');

    const now = Date.now();
    const data = invoices.map((invoice) => {
      const paid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
      const balance = Math.max(invoice.total - paid, 0);
      const daysPending = Math.floor((now - invoice.billDate.getTime()) / 86400000);
      const lastPayment = invoice.payments.length > 0 ? invoice.payments[invoice.payments.length - 1] : null;

      return {
        invoiceId: String(invoice._id),
        billDate: invoice.billDate,
        customer: invoice.customer,
        total: invoice.total,
        paid,
        balance,
        daysPending,
        agingBucket: getAgingBucket(daysPending),
        lastPayment: lastPayment
          ? {
              date: lastPayment.date,
              amount: lastPayment.amount,
              method: lastPayment.method,
            }
          : null,
      };
    });

    return ok(res, data);
  } catch (error) {
    next(error);
  }
};

export const getGivenPayments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate, customer } = req.query as {
      startDate?: string;
      endDate?: string;
      customer?: string;
    };

    const paymentMatch: Record<string, unknown> = {};
    if (startDate || endDate) {
      const range: Record<string, Date> = {};
      if (startDate) range.$gte = new Date(startDate);
      if (endDate) range.$lte = new Date(endDate);
      paymentMatch['payments.date'] = range;
    }
    if (customer) paymentMatch.customer = customer;

    const data = await Invoice.aggregate([
      { $unwind: '$payments' },
      { $match: paymentMatch },
      {
        $lookup: {
          from: 'customers',
          localField: 'customer',
          foreignField: '_id',
          as: 'customerData',
        },
      },
      { $unwind: '$customerData' },
      { $sort: { 'payments.date': -1 } },
      {
        $project: {
          _id: 0,
          invoiceId: { $toString: '$_id' },
          customer: {
            _id: { $toString: '$customerData._id' },
            name: '$customerData.name',
            mobileNumber: '$customerData.mobileNumber',
          },
          paymentDate: '$payments.date',
          amount: '$payments.amount',
          method: '$payments.method',
          invoiceTotal: '$total',
          isClearing: {
            $and: [
              { $ne: ['$billClearDate', null] },
              {
                $eq: [
                  { $dateToString: { format: '%Y-%m-%d', date: '$billClearDate' } },
                  { $dateToString: { format: '%Y-%m-%d', date: '$payments.date' } },
                ],
              },
            ],
          },
        },
      },
    ]);

    return ok(res, data);
  } catch (error) {
    next(error);
  }
};

