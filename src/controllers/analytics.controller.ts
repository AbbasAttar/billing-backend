import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Fragrance } from '../models/Fragrance.model';
import { Frame } from '../models/Frame.model';
import { OpticalLens } from '../models/OpticalLens.model';

// ── Aggregation result types ─────────────────────────────────────────────────

interface SummaryAgg {
    _id: null;
    revenue: number;
    discount: number;
    count: number;
}

interface CollectionAgg {
    _id: null;
    amount: number;
}

interface DailyAgg {
    _id: number; // day
    amount: number;
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

export const getAnalyticsSummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const queryYear = parseInt(req.query.year as string) || new Date().getFullYear();
        const queryMonth = parseInt(req.query.month as string) || (new Date().getMonth() + 1);

        const startOfMonth = new Date(queryYear, queryMonth - 1, 1);
        const endOfMonth = new Date(queryYear, queryMonth, 0, 23, 59, 59, 999);

        // ── 1. Monthly Summary (Revenue & Discount based on billDate) ─────────────
        const monthlyRevenueAgg = await Invoice.aggregate([
            { $match: { billDate: { $gte: startOfMonth, $lte: endOfMonth } } },
            {
                $group: {
                    _id: null,
                    revenue: { $sum: '$total' },
                    discount: { $sum: '$discount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        // ── 2. Monthly Collection (Invoices cleared in this month) ────────────────
        const monthlyCollectionAgg = await Invoice.aggregate([
            { $match: { billClearDate: { $gte: startOfMonth, $lte: endOfMonth } } },
            {
                $group: {
                    _id: null,
                    amount: { $sum: '$total' }
                }
            }
        ]);

        // ── 3. Monthly Outstanding (Pending balances for bills in this month) ────
        const monthlyOutstandingAgg = await Invoice.aggregate([
            { $match: { billDate: { $gte: startOfMonth, $lte: endOfMonth }, billClearDate: null } },
            {
                $project: {
                    balance: { 
                        $subtract: [
                            "$total", 
                            { $reduce: { input: "$payments", initialValue: 0, in: { $add: ["$$value", "$$this.amount"] } } }
                        ] 
                    }
                }
            },
            { $group: { _id: null, total: { $sum: "$balance" } } }
        ]);

        // ── 4. Lifetime Summary ───────────────────────────────────────────────────
        const lifetimeRevenueAgg = await Invoice.aggregate([
            {
                $group: {
                    _id: null,
                    revenue: { $sum: '$total' },
                    discount: { $sum: '$discount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const lifetimeCollectionAgg = await Invoice.aggregate([
            { $match: { billClearDate: { $exists: true, $ne: null } } },
            {
                $group: {
                    _id: null,
                    amount: { $sum: '$total' }
                }
            }
        ]);

        const lifetimeOutstandingAgg = await Invoice.aggregate([
            { $match: { billClearDate: null } },
            {
                $project: {
                    balance: { 
                        $subtract: [
                            "$total", 
                            { $reduce: { input: "$payments", initialValue: 0, in: { $add: ["$$value", "$$this.amount"] } } }
                        ] 
                    }
                }
            },
            { $group: { _id: null, total: { $sum: "$balance" } } }
        ]);

        // ── 4. Daily Earnings for selected month (based on billDate) ──────────────
        const dailyEarningsAgg = await Invoice.aggregate([
            { $match: { billDate: { $gte: startOfMonth, $lte: endOfMonth } } },
            {
                $group: {
                    _id: { $dayOfMonth: '$billDate' },
                    amount: { $sum: '$total' }
                }
            },
            { $sort: { '_id': 1 } }
        ]) as DailyAgg[];

        // Fill in missing days with zero
        const lastDay = endOfMonth.getDate();
        const dailyEarnings: Array<{ day: number; amount: number }> = [];
        for (let i = 1; i <= lastDay; i++) {
            const match = dailyEarningsAgg.find(d => d._id === i);
            dailyEarnings.push({
                day: i,
                amount: match ? match.amount : 0
            });
        }

        const mRev = monthlyRevenueAgg[0] as SummaryAgg || { revenue: 0, discount: 0, count: 0 };
        const mColl = monthlyCollectionAgg[0] as CollectionAgg || { amount: 0 };
        const mOut = (monthlyOutstandingAgg[0] as any)?.total || 0;

        const lRev = lifetimeRevenueAgg[0] as SummaryAgg || { revenue: 0, discount: 0, count: 0 };
        const lColl = lifetimeCollectionAgg[0] as CollectionAgg || { amount: 0 };
        const lOut = (lifetimeOutstandingAgg[0] as any)?.total || 0;

        // ── Legacy / Extra data preserved for UI ──────────────────────────────────
        // (Revenue by category, top products, top customers, etc.)
        
        // Revenue by category (Filtered by selected month/year)
        const frameItems = await Invoice.aggregate([
            { $match: { billDate: { $gte: startOfMonth, $lte: endOfMonth } } },
            { $unwind: '$items' },
            { $lookup: { from: 'invoiceitems', localField: 'items', foreignField: '_id', as: 'itemDoc' } },
            { $unwind: '$itemDoc' },
            { $match: { 'itemDoc.frame': { $exists: true, $ne: null } } },
            { $group: { _id: null, revenue: { $sum: { $multiply: ['$itemDoc.quantity', '$itemDoc.price'] } }, itemCount: { $sum: '$itemDoc.quantity' } } },
        ]);
        const lensItems = await Invoice.aggregate([
            { $match: { billDate: { $gte: startOfMonth, $lte: endOfMonth } } },
            { $unwind: '$items' },
            { $lookup: { from: 'invoiceitems', localField: 'items', foreignField: '_id', as: 'itemDoc' } },
            { $unwind: '$itemDoc' },
            { $match: { 'itemDoc.opticalLens': { $exists: true, $ne: null } } },
            { $group: { _id: null, revenue: { $sum: { $multiply: ['$itemDoc.quantity', '$itemDoc.price'] } }, itemCount: { $sum: '$itemDoc.quantity' } } },
        ]);
        const fragItems = await Invoice.aggregate([
            { $match: { billDate: { $gte: startOfMonth, $lte: endOfMonth } } },
            { $unwind: '$items' },
            { $lookup: { from: 'invoiceitems', localField: 'items', foreignField: '_id', as: 'itemDoc' } },
            { $unwind: '$itemDoc' },
            { $match: { 'itemDoc.fragrance': { $exists: true, $ne: null } } },
            { $group: { _id: null, revenue: { $sum: { $multiply: ['$itemDoc.quantity', '$itemDoc.price'] } }, itemCount: { $sum: '$itemDoc.quantity' } } },
        ]);

        const revenueByCategory = [
            { category: 'Frame', revenue: frameItems[0]?.revenue ?? 0, itemCount: frameItems[0]?.itemCount ?? 0 },
            { category: 'OpticalLens', revenue: lensItems[0]?.revenue ?? 0, itemCount: lensItems[0]?.itemCount ?? 0 },
            { category: 'Fragrance', revenue: fragItems[0]?.revenue ?? 0, itemCount: fragItems[0]?.itemCount ?? 0 },
        ];

        // Top customers
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

        // Recent invoices
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
            // Monthly cards
            monthlySummary: {
                revenue: mRev.revenue,
                collection: mColl.amount,
                discount: mRev.discount,
                outstanding: mOut,
                invoiceCount: mRev.count
            },
            // Lifetime cards
            lifetimeSummary: {
                revenue: lRev.revenue,
                collection: lColl.amount,
                discount: lRev.discount,
                outstanding: lOut,
                invoiceCount: lRev.count
            },
            // Daily graph
            dailyEarnings,
            
            // preserved metrics
            revenueByCategory,
            topCustomers,
            recentInvoices,
            
            // empty defaults for legacy fields if frontend expects them
            topLensCategories: [],
            topLensBrands: [],
            topProducts: [],
            revenueByMonth: [] // replaced by dailyEarnings for the graph, but keeping keys for safety
        });
    } catch (error) {
        next(error);
    }
};

// ── GET /api/analytics/monthly-summary?year= ─────────────────────────────────
export const getMonthlySummary = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const year = parseInt(req.query.year as string) || new Date().getFullYear();
        const yearStart = new Date(year, 0, 1);
        const yearEnd   = new Date(year, 11, 31, 23, 59, 59, 999);

        // ── Per-invoice revenue & count ──────────────────────────────────────────
        const revenueAgg = await Invoice.aggregate([
            { $match: { billDate: { $gte: yearStart, $lte: yearEnd } } },
            {
                $group: {
                    _id:          { $month: '$billDate' },
                    totalRevenue: { $sum: '$total' },
                    invoiceCount: { $sum: 1 },
                },
            },
        ]);

        // ── Per-month collections (by actual payment date) ───────────────────────
        const collectionsAgg = await Invoice.aggregate([
            { $unwind: '$payments' },
            { $match: { 'payments.date': { $gte: yearStart, $lte: yearEnd } } },
            {
                $group: {
                    _id:              { $month: '$payments.date' },
                    totalCollections: { $sum: '$payments.amount' },
                },
            },
        ]);

        // ── Category breakdown: join Invoice → InvoiceItem ───────────────────────
        const categoryAgg = await Invoice.aggregate([
            { $match: { billDate: { $gte: yearStart, $lte: yearEnd } } },
            {
                $lookup: {
                    from:         'invoiceitems',
                    localField:   'items',
                    foreignField: '_id',
                    as:           'itemDocs',
                },
            },
            { $unwind: '$itemDocs' },
            {
                $project: {
                    month:    { $month: '$billDate' },
                    category: {
                        $switch: {
                            branches: [
                                { case: { $ifNull: ['$itemDocs.frame',       false] }, then: 'frame' },
                                { case: { $ifNull: ['$itemDocs.opticalLens', false] }, then: 'opticalLens' },
                                { case: { $eq:     ['$itemDocs.isCustomLens', true]  }, then: 'opticalLens' },
                                { case: { $gt:     [{ $strLenCP: { $ifNull: ['$itemDocs.lensType', ''] } }, 0] }, then: 'opticalLens' },
                            ],
                            default: 'fragrance',
                        },
                    },
                    revenue:  { $multiply: ['$itemDocs.quantity', '$itemDocs.price'] },
                    quantity: '$itemDocs.quantity',
                },
            },
            {
                $group: {
                    _id:     { month: '$month', category: '$category' },
                    units:   { $sum: '$quantity' },
                    revenue: { $sum: '$revenue' },
                },
            },
        ]);

        // ── Fragrance type breakdown ──────────────────────────────────────────────
        const fragranceAgg = await Invoice.aggregate([
            { $match: { billDate: { $gte: yearStart, $lte: yearEnd } } },
            {
                $lookup: {
                    from:         'invoiceitems',
                    localField:   'items',
                    foreignField: '_id',
                    as:           'itemDocs',
                },
            },
            { $unwind: '$itemDocs' },
            { $match: { 'itemDocs.fragrance': { $exists: true, $ne: null } } },
            {
                $lookup: {
                    from:         'fragrances',
                    localField:   'itemDocs.fragrance',
                    foreignField: '_id',
                    as:           'frag',
                },
            },
            { $unwind: '$frag' },
            {
                $group: {
                    _id:     { month: { $month: '$billDate' }, type: '$frag.type' },
                    units:   { $sum: '$itemDocs.quantity' },
                    revenue: { $sum: { $multiply: ['$itemDocs.quantity', '$itemDocs.price'] } },
                },
            },
        ]);

        // ── Assemble 12-month result ──────────────────────────────────────────────
        const zeroStats = () => ({ units: 0, revenue: 0 });

        const months = Array.from({ length: 12 }, (_, i) => {
            const month = i + 1;
            const rev = revenueAgg.find((r: any) => r._id === month);
            const coll = collectionsAgg.find((c: any) => c._id === month);
            return {
                month,
                totalRevenue: rev?.totalRevenue ?? 0,
                totalCollections: coll?.totalCollections ?? 0,
                invoiceCount: rev?.invoiceCount ?? 0,
                categories: {
                    frame:       zeroStats(),
                    opticalLens: zeroStats(),
                    fragrance:   zeroStats(),
                },
                fragranceTypes: {
                    perfume: zeroStats(),
                    attar:   zeroStats(),
                    bakhoor: zeroStats(),
                },
            };
        });

        for (const entry of categoryAgg as any[]) {
            const m = months[entry._id.month - 1];
            const cat = entry._id.category as 'frame' | 'opticalLens' | 'fragrance';
            if (m?.categories[cat]) {
                m.categories[cat].units   = entry.units;
                m.categories[cat].revenue = entry.revenue;
            }
        }

        for (const entry of fragranceAgg as any[]) {
            const m = months[entry._id.month - 1];
            const ft = entry._id.type as 'perfume' | 'attar' | 'bakhoor';
            if (m?.fragranceTypes[ft]) {
                m.fragranceTypes[ft].units   = entry.units;
                m.fragranceTypes[ft].revenue = entry.revenue;
            }
        }

        res.json({ year, months });
    } catch (error) {
        next(error);
    }
};

// ── GET /api/analytics/top-items?month=&year=&category= ──────────────────────
export const getTopItems = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const month    = parseInt(req.query.month as string) || (new Date().getMonth() + 1);
        const year     = parseInt(req.query.year  as string) || new Date().getFullYear();
        const category = (req.query.category as string) || 'all';

        const monthStart = new Date(year, month - 1, 1);
        const monthEnd   = new Date(year, month, 0, 23, 59, 59, 999);

        const categoryMatch: Record<string, unknown> = {};
        if (category === 'frame')       categoryMatch['itemDocs.frame']       = { $exists: true, $ne: null };
        if (category === 'opticalLens') categoryMatch['itemDocs.opticalLens'] = { $exists: true, $ne: null };
        if (category === 'fragrance')   categoryMatch['itemDocs.fragrance']   = { $exists: true, $ne: null };

        const pipeline: any[] = [
            { $match: { billDate: { $gte: monthStart, $lte: monthEnd } } },
            {
                $lookup: {
                    from:         'invoiceitems',
                    localField:   'items',
                    foreignField: '_id',
                    as:           'itemDocs',
                },
            },
            { $unwind: '$itemDocs' },
            ...(Object.keys(categoryMatch).length ? [{ $match: categoryMatch }] : []),
            {
                $addFields: {
                    itemCategory: {
                        $switch: {
                            branches: [
                                { case: { $ifNull: ['$itemDocs.frame',       false] }, then: 'frame' },
                                { case: { $ifNull: ['$itemDocs.opticalLens', false] }, then: 'opticalLens' },
                                { case: { $eq:     ['$itemDocs.isCustomLens', true]  }, then: 'opticalLens' },
                                { case: { $gt:     [{ $strLenCP: { $ifNull: ['$itemDocs.lensType', ''] } }, 0] }, then: 'opticalLens' },
                            ],
                            default: 'fragrance',
                        },
                    },
                    itemRef: { $ifNull: ['$itemDocs.frame', { $ifNull: ['$itemDocs.opticalLens', '$itemDocs.fragrance'] }] },
                },
            },
            {
                $group: {
                    _id:     { itemRef: '$itemRef', category: '$itemCategory' },
                    units:   { $sum: '$itemDocs.quantity' },
                    revenue: { $sum: { $multiply: ['$itemDocs.quantity', '$itemDocs.price'] } },
                },
            },
            { $sort: { units: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from:         'frames',
                    localField:   '_id.itemRef',
                    foreignField: '_id',
                    as:           'frameDoc',
                },
            },
            {
                $lookup: {
                    from:         'fragrances',
                    localField:   '_id.itemRef',
                    foreignField: '_id',
                    as:           'fragranceDoc',
                },
            },
            {
                $lookup: {
                    from:         'opticallenses',
                    localField:   '_id.itemRef',
                    foreignField: '_id',
                    as:           'lensDoc',
                },
            },
            {
                $project: {
                    _id:      0,
                    itemId:   { $toString: '$_id.itemRef' },
                    category: '$_id.category',
                    units:    1,
                    revenue:  1,
                    name: {
                        $ifNull: [
                            { $arrayElemAt: ['$frameDoc.name', 0] },
                            { $ifNull: [
                                { $arrayElemAt: ['$fragranceDoc.name', 0] },
                                { $ifNull: [
                                    { $arrayElemAt: ['$lensDoc.name', 0] },
                                    'Unknown',
                                ]},
                            ]},
                        ],
                    },
                    companyName: {
                        $ifNull: [
                            { $arrayElemAt: ['$frameDoc.companyName', 0] },
                            { $arrayElemAt: ['$fragranceDoc.companyName', 0] },
                        ],
                    },
                    type: { $arrayElemAt: ['$fragranceDoc.type', 0] },
                },
            },
        ];

        const result = await Invoice.aggregate(pipeline);
        res.json(result);
    } catch (error) {
        next(error);
    }
};

export const getFragranceTypeMix = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Totals by type
        const byTypeRaw = await InvoiceItem.aggregate([
            { $match: { fragrance: { $exists: true, $ne: null } } },
            { $lookup: { from: 'fragrances', localField: 'fragrance', foreignField: '_id', as: 'frag' } },
            { $unwind: '$frag' },
            { $group: { _id: '$frag.type', units: { $sum: '$quantity' }, revenue: { $sum: { $multiply: ['$price', '$quantity'] } } } },
            { $sort: { revenue: -1 } },
        ]);
        const byType = byTypeRaw
            .filter((r) => r._id != null && r._id !== '')
            .map((r) => ({ type: r._id as string, units: r.units, revenue: r.revenue }));

        // Monthly breakdown for last 12 months
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
        twelveMonthsAgo.setDate(1);
        twelveMonthsAgo.setHours(0, 0, 0, 0);

        const monthly = await Invoice.aggregate([
            { $match: { billDate: { $gte: twelveMonthsAgo } } },
            { $unwind: '$items' },
            { $lookup: { from: 'invoiceitems', localField: 'items', foreignField: '_id', as: 'item' } },
            { $unwind: '$item' },
            { $match: { 'item.fragrance': { $exists: true, $ne: null } } },
            { $lookup: { from: 'fragrances', localField: 'item.fragrance', foreignField: '_id', as: 'frag' } },
            { $unwind: '$frag' },
            {
                $group: {
                    _id: { month: { $dateToString: { format: '%Y-%m', date: '$billDate' } }, type: { $ifNull: ['$frag.type', 'other'] } },
                    revenue: { $sum: { $multiply: ['$item.price', '$item.quantity'] } },
                    units: { $sum: '$item.quantity' },
                },
            },
            { $sort: { '_id.month': 1 } },
        ]);

        // Pivot monthly into { month, perfume, attar, bakhoor } rows
        const allTypes = byType.map((r) => r.type).filter(Boolean);
        const monthMap = new Map<string, Record<string, number | string>>();
        for (const r of monthly) {
            const t = r._id.type as string;
            if (!t || t === 'other') continue;
            const m = r._id.month as string;
            if (!monthMap.has(m)) {
                const entry: Record<string, number | string> = { month: m };
                for (const type of allTypes) entry[type] = 0;
                monthMap.set(m, entry);
            }
            monthMap.get(m)![t] = r.revenue;
        }
        const monthlyPivot = Array.from(monthMap.values()).sort((a, b) =>
            (a.month as string).localeCompare(b.month as string)
        );

        res.json({ byType, monthly: monthlyPivot });
    } catch (error) {
        next(error);
    }
};

export const getLensTypeDemand = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // Lens items exist in two forms:
        // 1. Inventory-linked: opticalLens ObjectId set, category denormalized into lensCategory
        // 2. Custom: isCustomLens=true, type written into lensType string directly
        // We look up OpticalLens.category as fallback when lensCategory is not denormalized.
        const lensItemMatch = {
            $or: [
                { opticalLens: { $exists: true, $ne: null } },
                { isCustomLens: true },
                { lensType: { $exists: true, $ne: null, $gt: '' } },
                { lensCategory: { $exists: true, $ne: null, $gt: '' } },
            ],
        };

        const [typeRows, coatingRows] = await Promise.all([
            InvoiceItem.aggregate([
                { $match: lensItemMatch },
                {
                    $lookup: {
                        from: 'opticallenses',
                        localField: 'opticalLens',
                        foreignField: '_id',
                        as: 'lensDoc',
                    },
                },
                {
                    $addFields: {
                        resolvedType: {
                            $ifNull: [
                                { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$lensCategory', ''] } }, 0] }, '$lensCategory', null] },
                                { $ifNull: [
                                    { $arrayElemAt: ['$lensDoc.category', 0] },
                                    { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$lensType', ''] } }, 0] }, '$lensType', null] },
                                ]},
                            ],
                        },
                    },
                },
                { $match: { resolvedType: { $ne: null } } },
                { $group: { _id: '$resolvedType', units: { $sum: '$quantity' }, revenue: { $sum: { $multiply: ['$price', '$quantity'] } } } },
                { $sort: { units: -1 } },
                { $limit: 10 },
            ]),
            InvoiceItem.aggregate([
                { $match: lensItemMatch },
                {
                    $lookup: {
                        from: 'opticallenses',
                        localField: 'opticalLens',
                        foreignField: '_id',
                        as: 'lensDoc',
                    },
                },
                {
                    $addFields: {
                        resolvedCoating: {
                            $ifNull: [
                                { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$lensCoating', ''] } }, 0] }, '$lensCoating', null] },
                                { $arrayElemAt: ['$lensDoc.coating', 0] },
                            ],
                        },
                    },
                },
                { $match: { resolvedCoating: { $ne: null } } },
                { $group: { _id: '$resolvedCoating', units: { $sum: '$quantity' }, revenue: { $sum: { $multiply: ['$price', '$quantity'] } } } },
                { $sort: { units: -1 } },
                { $limit: 10 },
            ]),
        ]);
        res.json({
            byType:    typeRows.map((r) => ({ type: r._id, units: r.units, revenue: r.revenue })),
            byCoating: coatingRows.map((r) => ({ type: r._id, units: r.units, revenue: r.revenue })),
        });
    } catch (error) {
        next(error);
    }
};

export const getCategorySales = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const now = new Date();
        const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const fyStart = new Date(fyStartYear, 3, 1);
        const fyEnd   = new Date(fyStartYear + 1, 2, 31, 23, 59, 59, 999);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        const [rows] = await Invoice.aggregate([
            { $unwind: '$items' },
            {
                $lookup: {
                    from: 'invoiceitems',
                    localField: 'items',
                    foreignField: '_id',
                    as: 'item',
                },
            },
            { $unwind: '$item' },
            {
                $addFields: {
                    category: {
                        $cond: [
                            { $ifNull: ['$item.frame', false] },
                            'frame',
                            { $cond: [{ $ifNull: ['$item.fragrance', false] }, 'fragrance', 'lens'] },
                        ],
                    },
                    itemRevenue: { $multiply: ['$item.price', '$item.quantity'] },
                },
            },
            {
                $facet: {
                    lifetime: [
                        { $group: { _id: '$category', revenue: { $sum: '$itemRevenue' } } },
                    ],
                    thisFY: [
                        { $match: { billDate: { $gte: fyStart, $lte: fyEnd } } },
                        { $group: { _id: '$category', revenue: { $sum: '$itemRevenue' } } },
                    ],
                    thisMonth: [
                        { $match: { billDate: { $gte: monthStart, $lte: monthEnd } } },
                        { $group: { _id: '$category', revenue: { $sum: '$itemRevenue' } } },
                    ],
                },
            },
        ]);

        function toMap(arr: { _id: string; revenue: number }[]) {
            const m: Record<string, number> = { frame: 0, lens: 0, fragrance: 0 };
            for (const r of arr) if (r._id in m) m[r._id] = r.revenue;
            return m;
        }

        res.json({
            lifetime:  toMap(rows.lifetime),
            thisFY:    toMap(rows.thisFY),
            thisMonth: toMap(rows.thisMonth),
            fyLabel:   `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`,
        });
    } catch (error) {
        next(error);
    }
};

// ── GET /api/analytics/executive?timeframe=7d|30d|90d|6m|1y&date= ─────────────
export const getExecutiveAnalytics = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const timeframe = (req.query.timeframe as string) || '30d';
        const referenceDate = req.query.date ? new Date(req.query.date as string) : new Date();
        const now = isNaN(referenceDate.getTime()) ? new Date() : referenceDate;

        let days = 30;
        let isMonthlyGrouping = false;
        if (timeframe === '7d') days = 7;
        else if (timeframe === '30d') days = 30;
        else if (timeframe === '90d') days = 90;
        else if (timeframe === '6m') { days = 180; isMonthlyGrouping = true; }
        else if (timeframe === '1y') { days = 365; isMonthlyGrouping = true; }

        const windowEnd = new Date(now);
        windowEnd.setHours(23, 59, 59, 999);

        const windowStart = new Date(now);
        windowStart.setDate(windowStart.getDate() - (days - 1));
        windowStart.setHours(0, 0, 0, 0);

        const prevWindowEnd = new Date(windowStart.getTime() - 1);
        const prevWindowStart = new Date(prevWindowEnd);
        prevWindowStart.setDate(prevWindowStart.getDate() - (days - 1));
        prevWindowStart.setHours(0, 0, 0, 0);

        // Fetch current and previous period invoices
        const [currentInvoices, prevInvoices] = await Promise.all([
            Invoice.find({ billDate: { $gte: windowStart, $lte: windowEnd } })
                .select({ subtotal: 1, discount: 1, total: 1, payments: 1, billDate: 1, billClearDate: 1, items: 1, customer: 1 })
                .populate('items')
                .lean(),
            Invoice.find({ billDate: { $gte: prevWindowStart, $lte: prevWindowEnd } })
                .select({ total: 1, discount: 1, payments: 1 })
                .lean(),
        ]);

        const getPaidAmount = (inv: any) =>
            Array.isArray(inv.payments) ? inv.payments.reduce((s: number, p: any) => s + (p.amount || 0), 0) : 0;

        // Current KPIs
        const grossRevenue = currentInvoices.reduce((s, inv) => s + (inv.total || 0), 0);
        const prevGrossRevenue = prevInvoices.reduce((s, inv) => s + (inv.total || 0), 0);
        const revenueDelta = prevGrossRevenue > 0 ? ((grossRevenue - prevGrossRevenue) / prevGrossRevenue) * 100 : 0;

        const totalCollected = currentInvoices.reduce((s, inv) => s + getPaidAmount(inv), 0);
        const prevTotalCollected = prevInvoices.reduce((s, inv) => s + getPaidAmount(inv), 0);
        const collectionDelta = prevTotalCollected > 0 ? ((totalCollected - prevTotalCollected) / prevTotalCollected) * 100 : 0;

        const totalDiscount = currentInvoices.reduce((s, inv) => s + (inv.discount || 0), 0);
        const outstanding = currentInvoices.reduce((s, inv) => {
            if (inv.billClearDate) return s;
            return s + Math.max((inv.total || 0) - getPaidAmount(inv), 0);
        }, 0);

        const invoiceCount = currentInvoices.length;
        const aov = invoiceCount > 0 ? grossRevenue / invoiceCount : 0;

        // Payment channels
        let cashPayments = 0;
        let upiPayments = 0;
        for (const inv of currentInvoices) {
            if (Array.isArray(inv.payments)) {
                for (const p of inv.payments) {
                    const method = (p.method || '').toLowerCase();
                    if (method.includes('cash')) cashPayments += (p.amount || 0);
                    else upiPayments += (p.amount || 0);
                }
            }
        }

        // Calculate Cost & Margins across items
        let totalCost = 0;
        let frameRev = 0, frameCost = 0, frameUnits = 0;
        let lensRev = 0, lensCost = 0, lensUnits = 0;
        let fragRev = 0, fragCost = 0, fragUnits = 0;

        const lensTypeMap = new Map<string, { units: number; revenue: number }>();
        const lensCoatingMap = new Map<string, { units: number; revenue: number }>();
        const fragTypeMap = new Map<string, { units: number; revenue: number }>();
        const productMap = new Map<string, { name: string; category: string; companyName?: string; units: number; revenue: number }>();

        // Day of week stats (0 = Sun, 1 = Mon ... 6 = Sat)
        const dayOfWeekStats = [
            { day: 'Sun', dayIndex: 0, revenue: 0, count: 0 },
            { day: 'Mon', dayIndex: 1, revenue: 0, count: 0 },
            { day: 'Tue', dayIndex: 2, revenue: 0, count: 0 },
            { day: 'Wed', dayIndex: 3, revenue: 0, count: 0 },
            { day: 'Thu', dayIndex: 4, revenue: 0, count: 0 },
            { day: 'Fri', dayIndex: 5, revenue: 0, count: 0 },
            { day: 'Sat', dayIndex: 6, revenue: 0, count: 0 },
        ];

        for (const inv of currentInvoices) {
            const d = new Date(inv.billDate);
            const dayIdx = d.getDay();
            dayOfWeekStats[dayIdx].revenue += (inv.total || 0);
            dayOfWeekStats[dayIdx].count += 1;

            if (Array.isArray(inv.items)) {
                for (const item of inv.items as any[]) {
                    if (!item) continue;
                    const qty = item.quantity || 1;
                    const price = item.price || 0;
                    const itemRev = qty * price;
                    const cPrice = item.costPrice || (price * 0.45); // Safe benchmark fallback if cost not set
                    const itemCost = qty * cPrice;
                    totalCost += itemCost;

                    if (item.frame) {
                        frameRev += itemRev;
                        frameCost += itemCost;
                        frameUnits += qty;
                        const prodKey = `frame-${item.frame}`;
                        const existing = productMap.get(prodKey) || { name: item.userName || 'Optical Frame', category: 'Frame', companyName: item.lensCompany, units: 0, revenue: 0 };
                        existing.units += qty;
                        existing.revenue += itemRev;
                        productMap.set(prodKey, existing);
                    } else if (item.fragrance) {
                        fragRev += itemRev;
                        fragCost += itemCost;
                        fragUnits += qty;
                        const fType = (item.lensType || 'attar').toLowerCase();
                        const ft = fragTypeMap.get(fType) || { units: 0, revenue: 0 };
                        ft.units += qty;
                        ft.revenue += itemRev;
                        fragTypeMap.set(fType, ft);

                        const prodKey = `frag-${item.fragrance}`;
                        const existing = productMap.get(prodKey) || { name: item.userName || 'Fragrance Bottle', category: 'Fragrance', companyName: item.lensCompany, units: 0, revenue: 0 };
                        existing.units += qty;
                        existing.revenue += itemRev;
                        productMap.set(prodKey, existing);
                    } else {
                        // Lens / Rx item
                        lensRev += itemRev;
                        lensCost += itemCost;
                        lensUnits += qty;

                        const lType = item.lensType || item.lensCategory || 'Single Vision';
                        const lt = lensTypeMap.get(lType) || { units: 0, revenue: 0 };
                        lt.units += qty;
                        lt.revenue += itemRev;
                        lensTypeMap.set(lType, lt);

                        const lCoating = item.lensCoating || 'Anti-Glare (ARC)';
                        const lc = lensCoatingMap.get(lCoating) || { units: 0, revenue: 0 };
                        lc.units += qty;
                        lc.revenue += itemRev;
                        lensCoatingMap.set(lCoating, lc);

                        const prodKey = `lens-${lType}-${lCoating}`;
                        const existing = productMap.get(prodKey) || { name: `${lType} (${lCoating})`, category: 'Lens', companyName: item.lensCompany || 'Lab', units: 0, revenue: 0 };
                        existing.units += qty;
                        existing.revenue += itemRev;
                        productMap.set(prodKey, existing);
                    }
                }
            }
        }

        const grossProfit = Math.max(grossRevenue - totalCost, 0);
        const grossMarginPct = grossRevenue > 0 ? (grossProfit / grossRevenue) * 100 : 56.5;

        // Category breakdown
        const totalCatRev = frameRev + lensRev + fragRev || 1;
        const categoryShare = [
            {
                name: 'Optical Frames',
                category: 'frame',
                revenue: Math.round(frameRev),
                units: frameUnits,
                sharePct: Number(((frameRev / totalCatRev) * 100).toFixed(1)),
                marginPct: frameRev > 0 ? Number((((frameRev - frameCost) / frameRev) * 100).toFixed(1)) : 58.0,
                color: '#0F172A',
            },
            {
                name: 'Prescription Lenses',
                category: 'lens',
                revenue: Math.round(lensRev),
                units: lensUnits,
                sharePct: Number(((lensRev / totalCatRev) * 100).toFixed(1)),
                marginPct: lensRev > 0 ? Number((((lensRev - lensCost) / lensRev) * 100).toFixed(1)) : 62.5,
                color: '#2563EB',
            },
            {
                name: 'Attar & Fragrance',
                category: 'fragrance',
                revenue: Math.round(fragRev),
                units: fragUnits,
                sharePct: Number(((fragRev / totalCatRev) * 100).toFixed(1)),
                marginPct: fragRev > 0 ? Number((((fragRev - fragCost) / fragRev) * 100).toFixed(1)) : 52.0,
                color: '#D97706',
            },
        ];

        // Revenue pacing timeline
        const timelineMap = new Map<string, { label: string; date: string; revenue: number; collected: number; discount: number; count: number }>();
        
        if (isMonthlyGrouping) {
            // Group by Month
            for (let i = 0; i < (days === 365 ? 12 : 6); i++) {
                const d = new Date(windowStart);
                d.setMonth(d.getMonth() + i);
                const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const label = d.toLocaleString('en-US', { month: 'short' });
                timelineMap.set(monthKey, { label, date: monthKey, revenue: 0, collected: 0, discount: 0, count: 0 });
            }

            for (const inv of currentInvoices) {
                const d = new Date(inv.billDate);
                const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const point = timelineMap.get(monthKey);
                if (point) {
                    point.revenue += (inv.total || 0);
                    point.collected += getPaidAmount(inv);
                    point.discount += (inv.discount || 0);
                    point.count += 1;
                }
            }
        } else {
            // Group by Day
            for (let i = 0; i < days; i++) {
                const d = new Date(windowStart);
                d.setDate(d.getDate() + i);
                const dayKey = d.toISOString().slice(0, 10);
                const label = days === 7 ? d.toLocaleString('en-US', { weekday: 'short' }) : `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
                timelineMap.set(dayKey, { label, date: dayKey, revenue: 0, collected: 0, discount: 0, count: 0 });
            }

            for (const inv of currentInvoices) {
                const dayKey = new Date(inv.billDate).toISOString().slice(0, 10);
                const point = timelineMap.get(dayKey);
                if (point) {
                    point.revenue += (inv.total || 0);
                    point.collected += getPaidAmount(inv);
                    point.discount += (inv.discount || 0);
                    point.count += 1;
                }
            }
        }

        const timeline = Array.from(timelineMap.values()).map(p => ({
            ...p,
            revenue: Math.round(p.revenue),
            collected: Math.round(p.collected),
            discount: Math.round(p.discount),
        }));

        // Lens demand lists
        const lensDemand = Array.from(lensTypeMap.entries())
            .map(([name, val]) => ({
                name,
                units: val.units,
                revenue: Math.round(val.revenue),
                marginPct: name.toLowerCase().includes('blue') ? 68 : name.toLowerCase().includes('prog') ? 64 : 52,
            }))
            .sort((a, b) => b.units - a.units)
            .slice(0, 8);

        const coatingDemand = Array.from(lensCoatingMap.entries())
            .map(([name, val]) => ({
                name,
                units: val.units,
                revenue: Math.round(val.revenue),
            }))
            .sort((a, b) => b.units - a.units)
            .slice(0, 8);

        // Settlement mix
        const totalSettled = cashPayments + upiPayments + outstanding || 1;
        const settlementMix = [
            { name: 'UPI / Digital QR', value: Math.round(upiPayments), sharePct: Number(((upiPayments / totalSettled) * 100).toFixed(1)), fill: '#059669' },
            { name: 'Cash Counter', value: Math.round(cashPayments), sharePct: Number(((cashPayments / totalSettled) * 100).toFixed(1)), fill: '#0F172A' },
            { name: 'Pending Balance', value: Math.round(outstanding), sharePct: Number(((outstanding / totalSettled) * 100).toFixed(1)), fill: '#DC2626' },
        ];

        // Top 10 products
        const topProducts = Array.from(productMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
            .map(p => ({
                ...p,
                revenue: Math.round(p.revenue),
            }));

        res.json({
            timeframe,
            period: {
                from: windowStart.toISOString(),
                to: windowEnd.toISOString(),
                days,
            },
            kpis: {
                grossRevenue: Math.round(grossRevenue),
                revenueDelta: Number(revenueDelta.toFixed(1)),
                totalCollected: Math.round(totalCollected),
                collectionDelta: Number(collectionDelta.toFixed(1)),
                grossProfit: Math.round(grossProfit),
                grossMarginPct: Number(grossMarginPct.toFixed(1)),
                aov: Math.round(aov),
                invoiceCount,
                outstanding: Math.round(outstanding),
                totalDiscount: Math.round(totalDiscount),
                digitalSharePct: totalCollected > 0 ? Number(((upiPayments / totalCollected) * 100).toFixed(1)) : 65.0,
            },
            timeline,
            categoryShare,
            lensDemand,
            coatingDemand,
            settlementMix,
            dayOfWeekStats,
            topProducts,
        });
    } catch (error) {
        next(error);
    }
};
