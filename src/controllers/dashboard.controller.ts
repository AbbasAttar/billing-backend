import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.model';
import { Customer } from '../models/Customer.model';
import { Expense } from '../models/Expense.model';
import { VendorBill } from '../models/VendorBill.model';
import { buildDashboardCommandCenter } from '../services/dashboardIntelligence';

// ── Helper: get today's date range ──────────────────────────────────────────
const getTodayRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end };
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const startOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
};

const endOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
};

const addDays = (date: Date, days: number) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
};

const diffInDays = (left: Date, right: Date) =>
    Math.ceil((startOfDay(left).getTime() - startOfDay(right).getTime()) / 86400000);

const toNumber = (value: unknown) => (typeof value === 'number' ? value : 0);
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const vendorCriticalityByCategory: Record<string, number> = {
    stock: 0.95,
    rent: 0.92,
    utilities: 0.88,
    maintenance: 0.7,
    salary: 0.96,
    transport: 0.65,
    marketing: 0.45,
    miscellaneous: 0.35,
};

const buildBillReason = (daysUntilDue: number, category: string, balance: number, reserveImpact: number) => {
    if (daysUntilDue < 0) return 'Overdue bill with immediate vendor and fee exposure.';
    if (daysUntilDue <= 3) return 'Due soon and should be protected in the payment queue.';
    if (reserveImpact < 0) return 'Paying this now may push cash below your operating buffer.';
    if (category === 'stock' || category === 'rent' || category === 'utilities') {
        return 'Core operating vendor bill with above-average business impact.';
    }
    if (balance > 50000) return 'Large payable that can materially affect short-term liquidity.';
    return 'Moderate urgency bill that can be scheduled around expected inflows.';
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

export const getCashFlowInsights = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const windowDays = clamp(Number(req.query.windowDays) || 30, 14, 90);
        const horizonDays = clamp(Number(req.query.horizonDays) || 14, 7, 45);
        const now = new Date();
        const historicalStart = startOfDay(addDays(now, -(windowDays - 1)));
        const previousStart = startOfDay(addDays(historicalStart, -windowDays));
        const previousEnd = endOfDay(addDays(historicalStart, -1));
        const forecastEnd = endOfDay(addDays(now, horizonDays));

        const [
            incomeAgg,
            previousIncomeAgg,
            expenseAgg,
            previousExpenseAgg,
            vendorPaymentAgg,
            previousVendorPaymentAgg,
            unpaidBills,
            receivableAgg,
            invoiceSalesAgg,
            settledInvoices,
            openInvoices,
        ] = await Promise.all([
            Invoice.aggregate([
                { $unwind: '$payments' },
                { $match: { 'payments.date': { $gte: historicalStart, $lte: now } } },
                { $group: { _id: null, total: { $sum: '$payments.amount' } } },
            ]),
            Invoice.aggregate([
                { $unwind: '$payments' },
                { $match: { 'payments.date': { $gte: previousStart, $lte: previousEnd } } },
                { $group: { _id: null, total: { $sum: '$payments.amount' } } },
            ]),
            Expense.aggregate([
                { $match: { date: { $gte: historicalStart, $lte: now }, isVoid: false } },
                { $group: { _id: null, total: { $sum: '$amount' } } },
            ]),
            Expense.aggregate([
                { $match: { date: { $gte: previousStart, $lte: previousEnd }, isVoid: false } },
                { $group: { _id: null, total: { $sum: '$amount' } } },
            ]),
            VendorBill.aggregate([
                { $unwind: { path: '$payments', preserveNullAndEmptyArrays: false } },
                { $match: { 'payments.date': { $gte: historicalStart, $lte: now } } },
                { $group: { _id: null, total: { $sum: '$payments.amount' } } },
            ]),
            VendorBill.aggregate([
                { $unwind: { path: '$payments', preserveNullAndEmptyArrays: false } },
                { $match: { 'payments.date': { $gte: previousStart, $lte: previousEnd } } },
                { $group: { _id: null, total: { $sum: '$payments.amount' } } },
            ]),
            VendorBill.find({ status: { $ne: 'paid' } }).sort({ dueDate: 1 }).lean(),
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
                        total: { $sum: { $max: [{ $subtract: ['$total', '$paid'] }, 0] } },
                    },
                },
            ]),
            Invoice.aggregate([
                { $match: { billDate: { $gte: historicalStart, $lte: now } } },
                { $group: { _id: null, total: { $sum: '$total' } } },
            ]),
            Invoice.find({
                billClearDate: { $ne: null, $gte: addDays(historicalStart, -60), $lte: now },
            })
                .select({ billDate: 1, billClearDate: 1, total: 1, payments: 1 })
                .lean(),
            Invoice.find({ billClearDate: null })
                .select({ customer: 1, billDate: 1, total: 1, payments: 1 })
                .populate('customer', 'name')
                .lean(),
        ]);

        const totalIncome = toNumber(incomeAgg[0]?.total);
        const previousIncome = toNumber(previousIncomeAgg[0]?.total);
        const totalExpenses = toNumber(expenseAgg[0]?.total);
        const previousExpenses = toNumber(previousExpenseAgg[0]?.total);
        const totalVendorPayments = toNumber(vendorPaymentAgg[0]?.total);
        const previousVendorPayments = toNumber(previousVendorPaymentAgg[0]?.total);
        const outstandingReceivables = toNumber(receivableAgg[0]?.total);
        const invoiceSales = toNumber(invoiceSalesAgg[0]?.total);

        const avgDailyIncome = totalIncome / windowDays;
        const avgDailyExpense = (totalExpenses + totalVendorPayments) / windowDays;
        const avgDailySales = invoiceSales / windowDays;
        const reserveTarget = Math.max(avgDailyExpense * 7, 0);
        const estimatedAvailableCash = totalIncome - totalExpenses - totalVendorPayments;

        const incomeDelta = previousIncome > 0 ? ((totalIncome - previousIncome) / previousIncome) * 100 : 0;
        const expenseDeltaBase = previousExpenses + previousVendorPayments;
        const expenseDelta = expenseDeltaBase > 0 ? (((totalExpenses + totalVendorPayments) - expenseDeltaBase) / expenseDeltaBase) * 100 : 0;

        const seasonalityLabel =
            incomeDelta >= 10
                ? 'stronger-than-usual collections'
                : incomeDelta <= -10
                    ? 'softer-than-usual collections'
                    : 'stable collection patterns';

        const collectionCycleDays = Math.round(
            clamp(
                average(
                    settledInvoices
                        .map((invoice) => diffInDays(new Date(String(invoice.billClearDate)), new Date(String(invoice.billDate))))
                        .filter((days) => Number.isFinite(days) && days >= 0)
                ) || 14,
                3,
                45
            )
        );

        const receivableSchedule = new Map<string, number>();
        const openReceivableForecast = openInvoices.map((invoice) => {
            const paidAmount = (invoice.payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
            const balance = Math.max(invoice.total - paidAmount, 0);
            const ageDays = Math.max(diffInDays(now, new Date(String(invoice.billDate))), 0);
            const partialPaymentBoost = paidAmount > 0 ? 0.15 : 0;
            const agePenalty = ageDays > collectionCycleDays * 2 ? 0.25 : ageDays > collectionCycleDays ? 0.12 : 0;
            const expectedCollectionRate = clamp(0.78 + partialPaymentBoost - agePenalty, 0.2, 0.96);
            const targetDays = ageDays >= collectionCycleDays
                ? Math.min(Math.max(2, Math.round(collectionCycleDays / 3)), horizonDays)
                : Math.min(Math.max(collectionCycleDays - ageDays, 1), horizonDays);
            const predictedCollectionDate = startOfDay(addDays(now, targetDays - 1));
            const collectableAmount = Number((balance * expectedCollectionRate).toFixed(2));
            const scheduleKey = predictedCollectionDate.toISOString();

            receivableSchedule.set(scheduleKey, (receivableSchedule.get(scheduleKey) ?? 0) + collectableAmount);

            return {
                invoiceId: String(invoice._id),
                customerName: typeof invoice.customer === 'object' && invoice.customer && 'name' in invoice.customer
                    ? String(invoice.customer.name)
                    : 'Customer',
                billDate: new Date(String(invoice.billDate)).toISOString(),
                balance: Number(balance.toFixed(2)),
                ageDays,
                predictedCollectionDate: predictedCollectionDate.toISOString(),
                collectableAmount,
                confidence: Math.round(expectedCollectionRate * 100),
            };
        }).sort((a, b) => new Date(a.predictedCollectionDate).getTime() - new Date(b.predictedCollectionDate).getTime());

        const forecastReceivablePool = openReceivableForecast.reduce((sum, invoice) => sum + invoice.collectableAmount, 0);
        const baselineNewCollectionsPerDay = Math.min(avgDailyIncome * 0.4, avgDailySales * 0.3);
        const priorityBills = unpaidBills.map((bill) => {
            const balance = Math.max(bill.totalAmount - bill.paidAmount, 0);
            const daysUntilDue = diffInDays(new Date(bill.dueDate), now);
            const dueUrgency = daysUntilDue < 0 ? 1 : clamp((horizonDays - daysUntilDue) / horizonDays, 0, 1);
            const vendorCriticality = vendorCriticalityByCategory[bill.category] ?? 0.5;
            const lateFeeRisk = daysUntilDue < 0 ? 1 : daysUntilDue <= 3 ? 0.8 : daysUntilDue <= 7 ? 0.55 : 0.25;
            const relationshipSensitivity = bill.paidAmount > 0 ? 0.65 : 0.45;
            const paymentHistoryFactor = bill.status === 'overdue' ? 0.9 : bill.status === 'partially_paid' ? 0.6 : 0.35;
            const amountPressure = reserveTarget > 0 ? clamp(balance / reserveTarget, 0, 1) : 0;
            const priorityScore = Math.round(
                (
                    dueUrgency * 0.28 +
                    vendorCriticality * 0.22 +
                    lateFeeRisk * 0.18 +
                    amountPressure * 0.15 +
                    relationshipSensitivity * 0.1 +
                    paymentHistoryFactor * 0.07
                ) * 100
            );
            const recommendedPaymentDate =
                daysUntilDue <= 0
                    ? startOfDay(now)
                    : startOfDay(addDays(now, Math.min(Math.max(daysUntilDue - 1, 0), 5)));
            const reserveImpact = estimatedAvailableCash - balance - reserveTarget;

            return {
                billId: String(bill._id),
                vendorName: bill.vendorName,
                category: bill.category,
                status: bill.status,
                dueDate: bill.dueDate.toISOString(),
                balance,
                totalAmount: bill.totalAmount,
                paidAmount: bill.paidAmount,
                daysUntilDue,
                priorityScore,
                riskScore: Math.round((lateFeeRisk * 0.45 + amountPressure * 0.35 + (daysUntilDue < 0 ? 1 : 0) * 0.2) * 100),
                recommendedPaymentDate: recommendedPaymentDate.toISOString(),
                recommendation:
                    daysUntilDue < 0
                        ? 'pay_now'
                        : reserveImpact < 0 && daysUntilDue > 2
                            ? 'schedule'
                            : bill.status === 'partially_paid'
                                ? 'pay_remaining'
                                : 'pay_now',
                reason: buildBillReason(daysUntilDue, bill.category, balance, reserveImpact),
            };
        }).sort((a, b) => b.priorityScore - a.priorityScore || a.daysUntilDue - b.daysUntilDue);

        const upcomingPayables = priorityBills
            .filter((bill) => bill.daysUntilDue <= horizonDays)
            .reduce((sum, bill) => sum + bill.balance, 0);

        const forecast = [];
        let projectedCash = estimatedAvailableCash;
        let shortageDate: string | null = null;

        for (let dayIndex = 0; dayIndex < horizonDays; dayIndex += 1) {
            const dayDate = startOfDay(addDays(now, dayIndex));
            const dayEnd = endOfDay(dayDate);
            const dueToday = priorityBills
                .filter((bill) => {
                    const dueDate = new Date(bill.dueDate);
                    return dueDate >= dayDate && dueDate <= dayEnd;
                })
                .reduce((sum, bill) => sum + bill.balance, 0);

            const scheduledInvoiceCollections = receivableSchedule.get(dayDate.toISOString()) ?? 0;
            const inflow = baselineNewCollectionsPerDay + scheduledInvoiceCollections;
            const outflow = avgDailyExpense + dueToday;
            projectedCash += inflow - outflow;

            const status =
                projectedCash < 0 ? 'critical' :
                    projectedCash < reserveTarget ? 'warning' : 'healthy';

            if (!shortageDate && projectedCash < reserveTarget) {
                shortageDate = dayDate.toISOString();
            }

            forecast.push({
                date: dayDate.toISOString(),
                inflow: Number(inflow.toFixed(2)),
                scheduledCollections: Number(scheduledInvoiceCollections.toFixed(2)),
                baselineCollections: Number(baselineNewCollectionsPerDay.toFixed(2)),
                outflow: Number(outflow.toFixed(2)),
                duePayments: Number(dueToday.toFixed(2)),
                projectedCash: Number(projectedCash.toFixed(2)),
                reserveTarget: Number(reserveTarget.toFixed(2)),
                status,
            });
        }

        const overdueBills = priorityBills.filter((bill) => bill.daysUntilDue < 0);
        const atRiskBills = priorityBills.filter((bill) => bill.daysUntilDue >= 0 && bill.daysUntilDue <= 7);
        const shortageRiskScore = clamp(
            Math.round(
                (
                    (forecast.some((day) => day.status === 'critical') ? 0.55 : forecast.some((day) => day.status === 'warning') ? 0.3 : 0.1) +
                    clamp(upcomingPayables / Math.max(reserveTarget || 1, 1), 0, 1) * 0.3 +
                    clamp(avgDailyExpense / Math.max(avgDailyIncome || 1, 1), 0, 1) * 0.15
                ) * 100
            ),
            0,
            100
        );

        const paymentHealthScore = clamp(
            Math.round(
                100 -
                shortageRiskScore * 0.45 -
                overdueBills.length * 8 -
                clamp(atRiskBills.length * 4, 0, 20)
            ),
            0,
            100
        );

        const alerts = [
            ...(shortageDate ? [{
                level: forecast.some((day) => day.status === 'critical') ? 'critical' : 'warning',
                title: 'Projected cash buffer dip',
                message: `Cash is forecasted to move below reserve on ${new Date(shortageDate).toLocaleDateString('en-IN')}.`,
            }] : []),
            ...(overdueBills.length ? [{
                level: 'critical',
                title: `${overdueBills.length} vendor bill${overdueBills.length > 1 ? 's are' : ' is'} overdue`,
                message: 'Immediate payment attention is recommended to avoid vendor friction and penalties.',
            }] : []),
            ...(outstandingReceivables > upcomingPayables ? [{
                level: 'info',
                title: 'Collections can absorb upcoming bills',
                message: 'Expected receivables are larger than near-term payables, so timing can be optimized.',
            }] : [{
                level: 'warning',
                title: 'Upcoming liabilities outweigh open receivables',
                message: 'Review payment scheduling and preserve buffer for core vendors.',
            }]),
            ...(openReceivableForecast.length ? [{
                level: 'info',
                title: `Invoice forecast expects ${openReceivableForecast.length} active collections`,
                message: `Average invoice collection cycle is ${collectionCycleDays} days based on paid invoices.`,
            }] : []),
        ];

        const suggestedActions = priorityBills.slice(0, 4).map((bill) => ({
            type: bill.recommendation,
            billId: bill.billId,
            title:
                bill.recommendation === 'schedule'
                    ? `Schedule ${bill.vendorName}`
                    : `Prioritize ${bill.vendorName}`,
            description:
                bill.recommendation === 'schedule'
                    ? `Schedule payment on ${new Date(bill.recommendedPaymentDate).toLocaleDateString('en-IN')} to stay on time without compressing your reserve.`
                    : `Pay ${bill.vendorName} first to protect liquidity and reduce due-date risk.`,
            amount: bill.balance,
            dueDate: bill.dueDate,
            recommendedPaymentDate: bill.recommendedPaymentDate,
            confidence: clamp(60 + Math.round(bill.priorityScore * 0.3), 0, 98),
        }));

        return res.json({
            overview: {
                historicalIncome: Number(totalIncome.toFixed(2)),
                historicalExpenses: Number(totalExpenses.toFixed(2)),
                historicalVendorPayments: Number(totalVendorPayments.toFixed(2)),
                estimatedAvailableCash: Number(estimatedAvailableCash.toFixed(2)),
                outstandingReceivables: Number(outstandingReceivables.toFixed(2)),
                expectedInvoiceCollections: Number(forecastReceivablePool.toFixed(2)),
                upcomingPayables: Number(upcomingPayables.toFixed(2)),
                reserveTarget: Number(reserveTarget.toFixed(2)),
                paymentHealthScore,
                shortageRiskScore,
                shortageDate,
            },
            trends: {
                avgDailyIncome: Number(avgDailyIncome.toFixed(2)),
                avgDailyExpense: Number(avgDailyExpense.toFixed(2)),
                avgDailySales: Number(avgDailySales.toFixed(2)),
                avgCollectionDays: collectionCycleDays,
                incomeDelta: Number(incomeDelta.toFixed(2)),
                expenseDelta: Number(expenseDelta.toFixed(2)),
                seasonalityLabel,
                seasonalityNote: `Collections are showing ${seasonalityLabel} over the last ${windowDays} days compared with the prior period.`,
            },
            forecast,
            invoiceForecast: openReceivableForecast.slice(0, 10),
            priorityBills,
            alerts,
            suggestedActions,
            assumptions: {
                windowDays,
                horizonDays,
                receivableRealizationRate: Number((outstandingReceivables > 0 ? forecastReceivablePool / outstandingReceivables : 0).toFixed(2)),
                reserveDays: 7,
            },
        });
    } catch (error) {
        next(error);
    }
};

const parseReferenceDate = (queryDate?: string) => {
    if (!queryDate) {
        return new Date();
    }

    const parsed = new Date(queryDate);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const getCommandCenter = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = await buildDashboardCommandCenter(parseReferenceDate(req.query.date as string | undefined));
        res.json(payload);
    } catch (error) {
        next(error);
    }
};

export const getDashboardOverview = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = await buildDashboardCommandCenter(parseReferenceDate(req.query.date as string | undefined));
        res.json({
            generatedAt: payload.generatedAt,
            period: payload.period,
            overview: payload.overview,
        });
    } catch (error) {
        next(error);
    }
};

export const getDashboardInsights = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = await buildDashboardCommandCenter(parseReferenceDate(req.query.date as string | undefined));
        res.json({
            generatedAt: payload.generatedAt,
            period: payload.period,
            insights: payload.insights,
        });
    } catch (error) {
        next(error);
    }
};

export const getCustomerIntelligence = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = await buildDashboardCommandCenter(parseReferenceDate(req.query.date as string | undefined));
        res.json({
            generatedAt: payload.generatedAt,
            period: payload.period,
            customerIntelligence: payload.customerIntelligence,
        });
    } catch (error) {
        next(error);
    }
};

export const getProductIntelligence = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = await buildDashboardCommandCenter(parseReferenceDate(req.query.date as string | undefined));
        res.json({
            generatedAt: payload.generatedAt,
            period: payload.period,
            productIntelligence: payload.productIntelligence,
        });
    } catch (error) {
        next(error);
    }
};

export const getSeasonalityIntelligence = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = await buildDashboardCommandCenter(parseReferenceDate(req.query.date as string | undefined));
        res.json({
            generatedAt: payload.generatedAt,
            period: payload.period,
            seasonality: payload.seasonality,
        });
    } catch (error) {
        next(error);
    }
};

export const getFinancialIntelligence = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = await buildDashboardCommandCenter(parseReferenceDate(req.query.date as string | undefined));
        res.json({
            generatedAt: payload.generatedAt,
            period: payload.period,
            financialIntelligence: payload.financialIntelligence,
        });
    } catch (error) {
        next(error);
    }
};

export const getActionQueue = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const payload = await buildDashboardCommandCenter(parseReferenceDate(req.query.date as string | undefined));
        res.json({
            generatedAt: payload.generatedAt,
            period: payload.period,
            actionQueue: payload.actionQueue,
        });
    } catch (error) {
        next(error);
    }
};
