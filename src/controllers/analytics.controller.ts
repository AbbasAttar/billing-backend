import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';

// ── Aggregation result types ─────────────────────────────────────────────────

interface RevenueAgg {
    totalRevenue: number;
    totalDiscount: number;
    invoiceCount: number;
    paidCount: number;
    partialCount: number;
}

interface CollectedAgg {
    totalCollected: number;
}

interface MonthAgg {
    _id: { year: number; month: number };
    revenue?: number;
    collected?: number;
}

interface CategoryAgg {
    _id: null;
    revenue: number;
    itemCount: number;
}

interface ProductAgg {
    _id: mongoose.Types.ObjectId;
    totalRevenue: number;
    unitsSold: number;
    product?: { name: string; companyName?: string };
    productId?: string;
    name?: string;
    type?: string;
}

// ── Controller ───────────────────────────────────────────────────────────────

export const getAnalyticsSummary = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        // ── Revenue metrics ─────────────────────────────────────────────────────
        const revenueAggRaw = await Invoice.aggregate([
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$total' },
                    totalDiscount: { $sum: '$discount' },
                    invoiceCount: { $sum: 1 },
                    paidCount: { $sum: { $cond: [{ $ifNull: ['$billClearDate', false] }, 1, 0] } },
                    partialCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $gt: [{ $size: { $ifNull: ['$payments', []] } }, 0] },
                                        { $not: { $ifNull: ['$billClearDate', false] } },
                                    ],
                                },
                                1,
                                0,
                            ],
                        },
                    },
                },
            },
        ]);

        const collectedAggRaw = await Invoice.aggregate([
            { $unwind: { path: '$payments', preserveNullAndEmptyArrays: true } },
            { $group: { _id: null, totalCollected: { $sum: '$payments.amount' } } },
        ]);

        const revenueAgg = revenueAggRaw[0] as RevenueAgg | undefined;
        const collectedAgg = collectedAggRaw[0] as CollectedAgg | undefined;

        const totalRevenue = revenueAgg?.totalRevenue ?? 0;
        const totalCollected = collectedAgg?.totalCollected ?? 0;
        const totalDiscount = revenueAgg?.totalDiscount ?? 0;
        const invoiceCount = revenueAgg?.invoiceCount ?? 0;
        const paidCount = revenueAgg?.paidCount ?? 0;
        const partialCount = revenueAgg?.partialCount ?? 0;
        const unpaidCount = invoiceCount - paidCount - partialCount;

        // ── Revenue by month (last 12 months) ───────────────────────────────────
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
        twelveMonthsAgo.setDate(1);

        const revenueByMonthRaw = (await Invoice.aggregate([
            { $match: { billDate: { $gte: twelveMonthsAgo } } },
            {
                $group: {
                    _id: { year: { $year: '$billDate' }, month: { $month: '$billDate' } },
                    revenue: { $sum: '$total' },
                },
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
        ])) as MonthAgg[];

        const collectedByMonthRaw = (await Invoice.aggregate([
            { $match: { billDate: { $gte: twelveMonthsAgo } } },
            { $unwind: { path: '$payments', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: { year: { $year: '$billDate' }, month: { $month: '$billDate' } },
                    collected: { $sum: '$payments.amount' },
                },
            },
        ])) as MonthAgg[];

        const collectedMap = new Map(
            collectedByMonthRaw.map((r) => [`${r._id.year}-${r._id.month}`, r.collected ?? 0])
        );

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const revenueByMonth = revenueByMonthRaw.map((r) => ({
            month: `${monthNames[r._id.month - 1]} ${r._id.year}`,
            revenue: r.revenue ?? 0,
            collected: collectedMap.get(`${r._id.year}-${r._id.month}`) ?? 0,
        }));

        // ── Revenue by category ──────────────────────────────────────────────────
        const frameItems = (await InvoiceItem.aggregate([
            { $match: { frame: { $exists: true, $ne: null } } },
            { $group: { _id: null, revenue: { $sum: { $multiply: ['$quantity', '$price'] } }, itemCount: { $sum: '$quantity' } } },
        ])) as CategoryAgg[];

        const lensItems = (await InvoiceItem.aggregate([
            { $match: { opticalLens: { $exists: true, $ne: null } } },
            { $group: { _id: null, revenue: { $sum: { $multiply: ['$quantity', '$price'] } }, itemCount: { $sum: '$quantity' } } },
        ])) as CategoryAgg[];

        const fragItems = (await InvoiceItem.aggregate([
            { $match: { fragrance: { $exists: true, $ne: null } } },
            { $group: { _id: null, revenue: { $sum: { $multiply: ['$quantity', '$price'] } }, itemCount: { $sum: '$quantity' } } },
        ])) as CategoryAgg[];

        const revenueByCategory = [
            { category: 'Frame', revenue: frameItems[0]?.revenue ?? 0, itemCount: frameItems[0]?.itemCount ?? 0 },
            { category: 'OpticalLens', revenue: lensItems[0]?.revenue ?? 0, itemCount: lensItems[0]?.itemCount ?? 0 },
            { category: 'Fragrance', revenue: fragItems[0]?.revenue ?? 0, itemCount: fragItems[0]?.itemCount ?? 0 },
        ];

        // ── Top 5 customers ──────────────────────────────────────────────────────
        const topCustomers = await Invoice.aggregate([
            { $group: { _id: '$customer', totalBilled: { $sum: '$total' }, invoiceCount: { $sum: 1 } } },
            { $sort: { totalBilled: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customerData' } },
            { $unwind: '$customerData' },
            {
                $project: {
                    customerId: { $toString: '$_id' },
                    name: '$customerData.name',
                    totalBilled: 1,
                    invoiceCount: 1,
                },
            },
        ]);

        // ── Top 5 products ───────────────────────────────────────────────────────
        const topFrames = (await InvoiceItem.aggregate([
            { $match: { frame: { $exists: true, $ne: null } } },
            { $group: { _id: '$frame', totalRevenue: { $sum: { $multiply: ['$quantity', '$price'] } }, unitsSold: { $sum: '$quantity' } } },
            { $sort: { totalRevenue: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'frames', localField: '_id', foreignField: '_id', as: 'product' } },
            { $unwind: '$product' },
            {
                $project: {
                    productId: { $toString: '$_id' },
                    name: { $concat: ['$product.companyName', ' ', '$product.name'] },
                    type: { $literal: 'Frame' },
                    totalRevenue: 1,
                    unitsSold: 1,
                },
            },
        ])) as ProductAgg[];

        const topLenses = (await InvoiceItem.aggregate([
            { $match: { opticalLens: { $exists: true, $ne: null } } },
            { $group: { _id: '$opticalLens', totalRevenue: { $sum: { $multiply: ['$quantity', '$price'] } }, unitsSold: { $sum: '$quantity' } } },
            { $sort: { totalRevenue: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'opticallenses', localField: '_id', foreignField: '_id', as: 'product' } },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    productId: { $toString: '$_id' },
                    name: { $ifNull: ['$product.name', 'Optical Lens'] },
                    type: { $literal: 'OpticalLens' },
                    totalRevenue: 1,
                    unitsSold: 1,
                },
            },
        ])) as ProductAgg[];

        const topFragrances = (await InvoiceItem.aggregate([
            { $match: { fragrance: { $exists: true, $ne: null } } },
            { $group: { _id: '$fragrance', totalRevenue: { $sum: { $multiply: ['$quantity', '$price'] } }, unitsSold: { $sum: '$quantity' } } },
            { $sort: { totalRevenue: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'fragrances', localField: '_id', foreignField: '_id', as: 'product' } },
            { $unwind: '$product' },
            {
                $project: {
                    productId: { $toString: '$_id' },
                    name: { $concat: ['$product.companyName', ' ', '$product.name'] },
                    type: { $literal: 'Fragrance' },
                    totalRevenue: 1,
                    unitsSold: 1,
                },
            },
        ])) as ProductAgg[];

        const allProducts = [...topFrames, ...topLenses, ...topFragrances]
            .sort((a, b) => (b.totalRevenue ?? 0) - (a.totalRevenue ?? 0))
            .slice(0, 5);

        // ── Recent 5 invoices ───────────────────────────────────────────────────
        const recentInvoicesRaw = await Invoice.find()
            .sort({ billDate: -1 })
            .limit(5)
            .populate('customer', 'name');

        const recentInvoices = recentInvoicesRaw.map((inv) => {
            const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
            let status: 'Paid' | 'Partially Paid' | 'Unpaid' = 'Unpaid';
            if (inv.billClearDate) status = 'Paid';
            else if (paid > 0) status = 'Partially Paid';
            const customer = inv.customer as unknown as { name: string };
            return {
                _id: (inv._id as mongoose.Types.ObjectId).toString(),
                customerName: customer?.name ?? '—',
                total: inv.total,
                billDate: inv.billDate.toISOString(),
                status,
            };
        });

        res.json({
            totalRevenue,
            totalCollected,
            totalOutstanding: totalRevenue - totalCollected,
            totalDiscount,
            invoiceCount,
            paidCount,
            partialCount,
            unpaidCount,
            revenueByMonth,
            revenueByCategory,
            topCustomers,
            topProducts: allProducts,
            recentInvoices,
        });
    } catch (error) {
        next(error);
    }
};
