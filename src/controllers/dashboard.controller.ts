import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.model';
import { Customer } from '../models/Customer.model';
import { Expense } from '../models/Expense.model';

// ── Helper: get today's date range ──────────────────────────────────────────
const getTodayRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end };
};

// ── GET /api/dashboard/daily ─────────────────────────────────────────────────
export const getDailyKPIs = async (req: Request, res: Response, next: NextFunction) => {
    try {
        let todayStart: Date;
        let todayEnd: Date;

        if (req.query.date) {
            const date = new Date(req.query.date as string);
            todayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
            todayEnd   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
        } else {
            const range = getTodayRange();
            todayStart = range.start;
            todayEnd   = range.end;
        }

        const [
            revenueAgg,
            invoicesCreatedAgg,
            pendingAgg,
            outstandingAgg,
            newCustomersAgg,
            billsClearedAgg,
            expensesTodayAgg,
            overdueAgg,
        ] = await Promise.all([
            // Today's revenue: sum of payments made today
            Invoice.aggregate([
                { $unwind: '$payments' },
                { $match: { 'payments.date': { $gte: todayStart, $lte: todayEnd } } },
                { $group: { _id: null, total: { $sum: '$payments.amount' } } },
            ]),

            // Invoices created today
            Invoice.countDocuments({ billDate: { $gte: todayStart, $lte: todayEnd } }),

            // Pending invoices (not cleared)
            Invoice.countDocuments({ billClearDate: null }),

            // Outstanding balance (sum of total - paid for uncleared invoices)
            Invoice.aggregate([
                { $match: { billClearDate: null } },
                {
                    $addFields: {
                        paid: { $sum: '$payments.amount' },
                    },
                },
                {
                    $group: {
                        _id: null,
                        balance: { $sum: { $subtract: ['$total', '$paid'] } },
                    },
                },
            ]),

            // New customers today
            Customer.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }),

            // Bills cleared today
            Invoice.countDocuments({ billClearDate: { $gte: todayStart, $lte: todayEnd } }),

            Expense.aggregate([
                { $match: { date: { $gte: todayStart, $lte: todayEnd }, isVoid: false } },
                { $group: { _id: null, total: { $sum: '$amount' } } },
            ]),

            Invoice.countDocuments({
                billClearDate: null,
                billDate: { $lt: new Date(Date.now() - (30 * 86400000)) },
            }),
        ]);

        const todayRevenue = (revenueAgg[0] as any)?.total ?? 0;
        const outstandingBalance = (outstandingAgg[0] as any)?.balance ?? 0;
        const expensesToday = (expensesTodayAgg[0] as any)?.total ?? 0;
        const pendingInvoicesCount = pendingAgg;

        res.json({
            todayRevenue,
            invoicesCreated:    invoicesCreatedAgg,
            pendingPayments:    pendingInvoicesCount,
            outstandingBalance,
            newCustomers:       newCustomersAgg,
            billsClearedToday:  billsClearedAgg,
            pendingInvoicesCount,
            pendingAmount: outstandingBalance,
            givenToday: todayRevenue,
            expensesToday,
            netCashToday: todayRevenue - expensesToday,
            overdueCount: overdueAgg,
        });
    } catch (error) {
        next(error);
    }
};

// ── GET /api/dashboard/recent-invoices ───────────────────────────────────────
export const getRecentInvoices = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const invoices = await Invoice.find()
            .sort({ billDate: -1 })
            .limit(10)
            .populate('customer', 'name mobileNumber');

        const result = invoices.map((inv) => {
            const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
            const customer = inv.customer as unknown as { _id: mongoose.Types.ObjectId; name: string; mobileNumber?: string };
            return {
                _id:          (inv._id as mongoose.Types.ObjectId).toString(),
                billDate:     inv.billDate.toISOString(),
                total:        inv.total,
                paid,
                balance:      Math.max(inv.total - paid, 0),
                billClearDate: inv.billClearDate ? inv.billClearDate.toISOString() : null,
                customer: {
                    _id:          customer._id.toString(),
                    name:         customer.name,
                    mobileNumber: customer.mobileNumber,
                },
            };
        });

        res.json(result);
    } catch (error) {
        next(error);
    }
};

// ── GET /api/dashboard/recent-payments ──────────────────────────────────────
export const getRecentPayments = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await Invoice.aggregate([
            { $unwind: '$payments' },
            { $sort: { 'payments.date': -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from:         'customers',
                    localField:   'customer',
                    foreignField: '_id',
                    as:           'customerData',
                },
            },
            { $unwind: { path: '$customerData', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id:          0,
                    invoiceId:    { $toString: '$_id' },
                    customerName: '$customerData.name',
                    amount:       '$payments.amount',
                    date:         '$payments.date',
                },
            },
        ]);

        res.json(result);
    } catch (error) {
        next(error);
    }
};
