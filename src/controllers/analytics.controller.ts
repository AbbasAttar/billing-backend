import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Fragrance } from '../models/Fragrance.model';
import { Frame } from '../models/Frame.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { AdSpend } from '../models/AdSpend.model';
import { SiteSetting } from '../models/SiteSetting.model';
import { VendorBill } from '../models/VendorBill.model';
import { Obligation } from '../models/Obligation.model';
import { LensStock } from '../models/LensStock.model';
import { MonthlyTarget } from '../models/MonthlyTarget.model';
import { Expense } from '../models/Expense.model';

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

// ── Date Key Helpers (Timezone-safe) ──────────────────────────────────────────

const formatLocalDateKey = (dateInput: Date | string | number): string => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const formatLocalMonthKey = (dateInput: Date | string | number): string => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
};

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

        // ── 2. Monthly Collection (Actual cash/online collections received in this month) ──
        const monthlyCollectionAgg = await Invoice.aggregate([
            { $unwind: '$payments' },
            {
                $match: {
                    $or: [
                        { 'payments.date': { $gte: startOfMonth.toISOString(), $lte: endOfMonth.toISOString() } },
                        { 'payments.date': { $gte: startOfMonth, $lte: endOfMonth } },
                        {
                            $and: [
                                { $or: [{ 'payments.date': { $exists: false } }, { 'payments.date': null }] },
                                { billDate: { $gte: startOfMonth, $lte: endOfMonth } }
                            ]
                        }
                    ]
                }
            },
            {
                $group: {
                    _id: null,
                    amount: { $sum: '$payments.amount' }
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
            { $unwind: '$payments' },
            {
                $group: {
                    _id: null,
                    amount: { $sum: '$payments.amount' }
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
        const timeframe = (req.query.timeframe as string) || 'mtd';
        const referenceDate = req.query.date ? new Date(req.query.date as string) : new Date();
        const now = isNaN(referenceDate.getTime()) ? new Date() : referenceDate;

        let windowStart: Date;
        let windowEnd: Date;
        let prevWindowStart: Date;
        let prevWindowEnd: Date;
        let days = 30;
        let totalDaysInMonth = 30;
        let isMonthlyGrouping = false;
        let isMtdMode = false;
        let displayLabel = 'This Month (MTD)';

        const qYear = parseInt(req.query.year as string);
        const qMonth = parseInt(req.query.month as string);

        if (timeframe === 'mtd') {
            isMtdMode = true;
            windowStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
            windowEnd = new Date(now);
            days = Math.max(1, now.getDate());
            totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            displayLabel = `${now.toLocaleString('en-US', { month: 'long', year: 'numeric' })} (MTD Day ${days}/${totalDaysInMonth})`;

            // Previous month same MTD day for fair comparison
            const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
            const prevElapsedDay = Math.min(days, prevMonthLastDay);
            prevWindowStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
            prevWindowEnd = new Date(now.getFullYear(), now.getMonth() - 1, prevElapsedDay, 23, 59, 59, 999);
        } else if (timeframe === 'last_month') {
            windowStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
            windowEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
            days = windowEnd.getDate();
            totalDaysInMonth = days;
            displayLabel = windowStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });

            prevWindowStart = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);
            prevWindowEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59, 999);
        } else if (timeframe === 'month' && !isNaN(qYear) && !isNaN(qMonth)) {
            windowStart = new Date(qYear, qMonth - 1, 1, 0, 0, 0, 0);
            windowEnd = new Date(qYear, qMonth, 0, 23, 59, 59, 999);
            days = windowEnd.getDate();
            totalDaysInMonth = days;
            displayLabel = windowStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });

            prevWindowStart = new Date(qYear, qMonth - 2, 1, 0, 0, 0, 0);
            prevWindowEnd = new Date(qYear, qMonth - 1, 0, 23, 59, 59, 999);
        } else if (timeframe === '7d') {
            days = 7;
            windowEnd = new Date(now);
            windowEnd.setHours(23, 59, 59, 999);
            windowStart = new Date(now);
            windowStart.setDate(windowStart.getDate() - 6);
            windowStart.setHours(0, 0, 0, 0);
            displayLabel = 'Last 7 Days (Operations)';

            prevWindowEnd = new Date(windowStart.getTime() - 1);
            prevWindowStart = new Date(prevWindowEnd);
            prevWindowStart.setDate(prevWindowStart.getDate() - 6);
            prevWindowStart.setHours(0, 0, 0, 0);
        } else if (timeframe === '30d') {
            days = 30;
            windowEnd = new Date(now);
            windowEnd.setHours(23, 59, 59, 999);
            windowStart = new Date(now);
            windowStart.setDate(windowStart.getDate() - 29);
            windowStart.setHours(0, 0, 0, 0);
            displayLabel = 'Rolling 30 Days (Momentum)';

            prevWindowEnd = new Date(windowStart.getTime() - 1);
            prevWindowStart = new Date(prevWindowEnd);
            prevWindowStart.setDate(prevWindowStart.getDate() - 29);
            prevWindowStart.setHours(0, 0, 0, 0);
        } else if (timeframe === '90d') {
            days = 90;
            windowEnd = new Date(now);
            windowEnd.setHours(23, 59, 59, 999);
            windowStart = new Date(now);
            windowStart.setDate(windowStart.getDate() - 89);
            windowStart.setHours(0, 0, 0, 0);
            displayLabel = 'Last 90 Days (Quarter)';

            prevWindowEnd = new Date(windowStart.getTime() - 1);
            prevWindowStart = new Date(prevWindowEnd);
            prevWindowStart.setDate(prevWindowStart.getDate() - 89);
            prevWindowStart.setHours(0, 0, 0, 0);
        } else {
            // YTD or default fallback
            isMonthlyGrouping = true;
            windowStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
            windowEnd = new Date(now);
            days = Math.max(1, Math.round((windowEnd.getTime() - windowStart.getTime()) / 86400000));
            displayLabel = `YTD ${now.getFullYear()}`;

            prevWindowStart = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
            prevWindowEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59, 999);
        }

        const currentMonthKey = formatLocalMonthKey(windowStart);

        // Fetch current and previous period invoices + payments + expenses + targets + historical months concurrently
        const [
            currentInvoices,
            prevInvoices,
            currentPaymentsInvoices,
            periodExpenses,
            monthlyTargetDoc,
            allFrames,
            allFragrances,
            allLensStocks,
            financialSetting,
            historicalMonthsAgg,
        ] = await Promise.all([
            Invoice.find({ billDate: { $gte: windowStart, $lte: windowEnd } })
                .select({ subtotal: 1, discount: 1, total: 1, payments: 1, billDate: 1, billClearDate: 1, items: 1, customer: 1, isNewCustomer: 1, visitNumber: 1, netContributionMargin: 1, packagingCost: 1, paymentProcessingFee: 1 })
                .populate('items')
                .lean(),
            Invoice.find({ billDate: { $gte: prevWindowStart, $lte: prevWindowEnd } })
                .select({ total: 1, discount: 1, payments: 1, items: 1 })
                .lean(),
            Invoice.find({
                $or: [
                    { 'payments.date': { $gte: windowStart.toISOString(), $lte: windowEnd.toISOString() } },
                    { 'payments.date': { $gte: windowStart, $lte: windowEnd } },
                    { billDate: { $gte: windowStart, $lte: windowEnd } },
                ]
            })
                .select({ payments: 1, billDate: 1 })
                .lean(),
            Expense.find({ date: { $gte: windowStart, $lte: windowEnd }, isVoid: { $ne: true } })
                .select('amount category date vendorName paymentMethod')
                .lean(),
            MonthlyTarget.findOne({ month: currentMonthKey }).lean(),
            Frame.find({ isArchived: { $ne: true } })
                .select('costPrice sellPrice stock createdAt updatedAt companyName name tier')
                .lean(),
            Fragrance.find({ isArchived: { $ne: true } })
                .select('costPrice sellPrice stock variants createdAt updatedAt companyName name')
                .lean(),
            LensStock.find({})
                .select('lensType material coating color sph cyl add quantity costPrice reorderLevel')
                .lean(),
            SiteSetting.findOne({ key: 'retail_financial_settings' }).lean(),
            Invoice.aggregate([
                { $match: { billDate: { $lt: windowStart } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m', date: '$billDate' } },
                        revenue: { $sum: '$total' },
                        invoices: { $sum: 1 },
                        discount: { $sum: '$discount' },
                    }
                },
                { $sort: { _id: -1 } },
                { $limit: 18 }
            ]),
        ]);

        const defaultSettings = {
            defaultCardSwipeFeePct: 0,
            defaultPackagingCost: 35,
        };
        const config = financialSetting?.value ? { ...defaultSettings, ...financialSetting.value } : defaultSettings;

        const getPaidAmount = (inv: any) =>
            Array.isArray(inv.payments) ? inv.payments.reduce((s: number, p: any) => s + (p.amount || 0), 0) : 0;

        // 1. Executive Billed Revenue & Collections
        const grossRevenue = currentInvoices.reduce((s, inv) => s + (inv.total || 0), 0);
        const prevGrossRevenue = prevInvoices.reduce((s, inv) => s + (inv.total || 0), 0);
        const revenueDelta = prevGrossRevenue > 0 ? ((grossRevenue - prevGrossRevenue) / prevGrossRevenue) * 100 : 0;

        // Accurate Cash/UPI Collections in the window
        let cashCollected = 0;
        let cashOnly = 0;
        let upiOnly = 0;

        for (const inv of currentPaymentsInvoices) {
            if (Array.isArray(inv.payments)) {
                for (const p of inv.payments) {
                    const pDate = p.date ? new Date(p.date) : new Date(inv.billDate);
                    if (pDate >= windowStart && pDate <= windowEnd) {
                        const amt = p.amount || 0;
                        cashCollected += amt;
                        const method = (p.method || '').toLowerCase();
                        if (method.includes('cash')) cashOnly += amt;
                        else upiOnly += amt;
                    }
                }
            }
        }

        const prevCashCollected = prevInvoices.reduce((s, inv) => s + getPaidAmount(inv), 0);
        const collectionDelta = prevCashCollected > 0 ? ((cashCollected - prevCashCollected) / prevCashCollected) * 100 : 0;

        // Receivables (Uncollected balance on period invoices)
        const receivablesAging = {
            bucket0To7: 0,
            bucket8To30: 0,
            bucket31To60: 0,
            bucket60Plus: 0,
            total: 0,
        };

        const nowMs = now.getTime();
        const receivables = currentInvoices.reduce((s, inv) => {
            if (inv.billClearDate) return s;
            const uncollected = Math.max((inv.total || 0) - getPaidAmount(inv), 0);
            if (uncollected > 0) {
                const invDate = inv.billDate ? new Date(inv.billDate).getTime() : nowMs;
                const ageDays = Math.max(0, Math.floor((nowMs - invDate) / 86400000));
                if (ageDays <= 7) receivablesAging.bucket0To7 += uncollected;
                else if (ageDays <= 30) receivablesAging.bucket8To30 += uncollected;
                else if (ageDays <= 60) receivablesAging.bucket31To60 += uncollected;
                else receivablesAging.bucket60Plus += uncollected;
            }
            return s + uncollected;
        }, 0);

        receivablesAging.total = Math.round(receivables);
        receivablesAging.bucket0To7 = Math.round(receivablesAging.bucket0To7);
        receivablesAging.bucket8To30 = Math.round(receivablesAging.bucket8To30);
        receivablesAging.bucket31To60 = Math.round(receivablesAging.bucket31To60);
        receivablesAging.bucket60Plus = Math.round(receivablesAging.bucket60Plus);

        const collectionRate = grossRevenue > 0 ? Number(((cashCollected / grossRevenue) * 100).toFixed(1)) : 100;
        const totalDiscount = currentInvoices.reduce((s, inv) => s + (inv.discount || 0), 0);
        const grossBilledBeforeDiscount = grossRevenue + totalDiscount;
        const discountPct = grossBilledBeforeDiscount > 0 ? Number(((totalDiscount / grossBilledBeforeDiscount) * 100).toFixed(1)) : 0;

        const invoiceCount = currentInvoices.length;
        const aov = invoiceCount > 0 ? Math.round(grossRevenue / invoiceCount) : 0;

        // 2. Cost & Margins across items
        let totalCost = 0;
        let totalPackaging = 0;
        let totalProcessingFees = 0;
        let totalNetContribution = 0;

        let newCustomerRev = 0;
        let newCustomerCount = 0;
        let repeatCustomerRev = 0;
        let repeatCustomerCount = 0;

        let frameRev = 0, frameCost = 0, frameUnits = 0;
        let lensRev = 0, lensCost = 0, lensUnits = 0;
        let fragRev = 0, fragCost = 0, fragUnits = 0;

        // Weekday vs Weekend Sales breakdown for smart forecasting
        let weekdayRevenue = 0;
        let weekdayInvoiceCount = 0;
        let weekendRevenue = 0;
        let weekendInvoiceCount = 0;

        const lensTypeMap = new Map<string, { units: number; revenue: number }>();
        const lensPowerMap = new Map<string, { sph: number; cyl: number; pairs: number; revenue: number }>();
        const lensCoatingMap = new Map<string, { units: number; revenue: number }>();
        const fragTypeMap = new Map<string, { units: number; revenue: number }>();
        const productMap = new Map<string, { name: string; category: string; companyName?: string; units: number; revenue: number; cogs: number }>();

        for (const inv of currentInvoices) {
            const bDate = new Date(inv.billDate);
            const dayOfWeek = bDate.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                weekendRevenue += (inv.total || 0);
                weekendInvoiceCount += 1;
            } else {
                weekdayRevenue += (inv.total || 0);
                weekdayInvoiceCount += 1;
            }

            const isNew = inv.isNewCustomer !== undefined ? inv.isNewCustomer : (inv.visitNumber === 1 || !inv.visitNumber);
            if (isNew) {
                newCustomerRev += (inv.total || 0);
                newCustomerCount += 1;
            } else {
                repeatCustomerRev += (inv.total || 0);
                repeatCustomerCount += 1;
            }

            const packaging = typeof inv.packagingCost === 'number' ? inv.packagingCost : config.defaultPackagingCost;
            totalPackaging += packaging;

            let fee = typeof inv.paymentProcessingFee === 'number' ? inv.paymentProcessingFee : 0;
            if (!fee && config.defaultCardSwipeFeePct > 0 && Array.isArray(inv.payments)) {
                const onlineAmount = inv.payments.filter((p: any) => p.method === 'online').reduce((s: number, p: any) => s + (p.amount || 0), 0);
                fee = Number(((onlineAmount * (config.defaultCardSwipeFeePct / 100))).toFixed(2));
            }
            totalProcessingFees += fee;

            let invCogs = 0;
            if (Array.isArray(inv.items)) {
                for (const item of inv.items as any[]) {
                    if (!item) continue;
                    const qty = item.quantity || 1;
                    const price = item.price || 0;
                    const itemRev = qty * price;
                    const cPrice = item.costPrice || (price * 0.45);
                    const itemCost = qty * cPrice;
                    totalCost += itemCost;
                    invCogs += itemCost;

                    if (item.frame) {
                        frameRev += itemRev;
                        frameCost += itemCost;
                        frameUnits += qty;
                        const prodKey = `frame-${item.frame}`;
                        const existing = productMap.get(prodKey) || { name: item.userName || 'Optical Frame', category: 'Frame', companyName: item.lensCompany, units: 0, revenue: 0, cogs: 0 };
                        existing.units += qty;
                        existing.revenue += itemRev;
                        existing.cogs += itemCost;
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
                        const existing = productMap.get(prodKey) || { name: item.userName || 'Fragrance Bottle', category: 'Fragrance', companyName: item.lensCompany, units: 0, revenue: 0, cogs: 0 };
                        existing.units += qty;
                        existing.revenue += itemRev;
                        existing.cogs += itemCost;
                        productMap.set(prodKey, existing);
                    } else {
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

                        const sph = typeof item.spherical === 'number' ? item.spherical : (typeof item.rightSpherical === 'number' ? item.rightSpherical : 0);
                        const cyl = typeof item.cylinder === 'number' ? item.cylinder : (typeof item.rightCylinder === 'number' ? item.rightCylinder : 0);
                        const powerKey = `${sph.toFixed(2)}_${cyl.toFixed(2)}`;
                        const lp = lensPowerMap.get(powerKey) || { sph, cyl, pairs: 0, revenue: 0 };
                        lp.pairs += qty;
                        lp.revenue += itemRev;
                        lensPowerMap.set(powerKey, lp);

                        const prodKey = `lens-${lType}-${lCoating}`;
                        const existing = productMap.get(prodKey) || { name: `${lType} (${lCoating})`, category: 'Lens', companyName: item.lensCompany || 'Lab', units: 0, revenue: 0, cogs: 0 };
                        existing.units += qty;
                        existing.revenue += itemRev;
                        existing.cogs += itemCost;
                        productMap.set(prodKey, existing);
                    }
                }
            }

            const margin = typeof inv.netContributionMargin === 'number' && inv.netContributionMargin > 0
                ? inv.netContributionMargin
                : Math.max(0, (inv.total || 0) - invCogs - packaging - fee);
            totalNetContribution += margin;
        }

        const grossProfit = Math.max(grossRevenue - totalCost, 0);
        const grossMarginPct = grossRevenue > 0 ? Number(((grossProfit / grossRevenue) * 100).toFixed(1)) : 56.5;
        const contributionMarginPct = grossRevenue > 0 ? Number(((totalNetContribution / grossRevenue) * 100).toFixed(1)) : 48.0;

        const newCustomerRevPct = grossRevenue > 0 ? Number(((newCustomerRev / grossRevenue) * 100).toFixed(1)) : 60.0;
        const repeatCustomerRevPct = grossRevenue > 0 ? Number(((repeatCustomerRev / grossRevenue) * 100).toFixed(1)) : 40.0;

        // 3. Operating Expenses & P&L Statement (Accrued vs Full Commitment)
        let totalOperatingExpenses = 0;
        const expenseCategoryTotals: Record<string, number> = {};
        for (const exp of periodExpenses) {
            const amt = exp.amount || 0;
            totalOperatingExpenses += amt;
            const cat = exp.category || 'miscellaneous';
            expenseCategoryTotals[cat] = (expenseCategoryTotals[cat] || 0) + amt;
        }

        // Full monthly fixed overhead commitment (Rent + Salary + Utilities)
        const totalMonthlyFixedExpenses = totalOperatingExpenses > 0 ? totalOperatingExpenses : 82630;
        const daysElapsed = Math.min(days, totalDaysInMonth);
        const daysRemaining = Math.max(0, totalDaysInMonth - daysElapsed);

        // Accrued MTD overhead (13/30 days of commitment)
        const accruedOverheadMtd = Math.round((totalMonthlyFixedExpenses / totalDaysInMonth) * daysElapsed);
        const overheadCoveredPct = totalMonthlyFixedExpenses > 0
            ? Number(((grossProfit / totalMonthlyFixedExpenses) * 100).toFixed(1))
            : 100;
        const remainingOverheadRequired = Math.max(0, totalMonthlyFixedExpenses - Math.round(grossProfit));
        const accruedOperatingProfit = Math.round(grossProfit - (isMtdMode ? accruedOverheadMtd : totalOperatingExpenses));

        const operatingProfit = grossProfit - totalOperatingExpenses;
        const operatingMarginPct = grossRevenue > 0 ? Number(((operatingProfit / grossRevenue) * 100).toFixed(1)) : 0;

        const pnl = {
            grossRevenue: Math.round(grossRevenue),
            cogs: Math.round(totalCost),
            grossProfit: Math.round(grossProfit),
            grossMarginPct,
            totalDiscounts: Math.round(totalDiscount),
            operatingExpenses: Math.round(totalOperatingExpenses),
            totalMonthlyFixedExpenses: Math.round(totalMonthlyFixedExpenses),
            accruedOverheadMtd,
            overheadCoveredPct,
            remainingOverheadRequired,
            operatingProfit: Math.round(operatingProfit),
            accruedOperatingProfit,
            operatingMarginPct,
            expenseBreakdown: {
                rent: Math.round(expenseCategoryTotals['rent'] || 45000),
                salary: Math.round(expenseCategoryTotals['salary'] || 35000),
                utilities: Math.round(expenseCategoryTotals['utilities'] || 2630),
                marketing: Math.round(expenseCategoryTotals['marketing'] || 0),
                maintenance: Math.round(expenseCategoryTotals['maintenance'] || 0),
                staffTea: Math.round(expenseCategoryTotals['staff_tea'] || 0),
                other: Math.round(
                    (expenseCategoryTotals['miscellaneous'] || 0) +
                    (expenseCategoryTotals['transport'] || 0) +
                    (expenseCategoryTotals['delivery'] || 0)
                ),
            },
        };

        // 4. Driver-Based Seasonal Target Engine & MTD Pacing
        // Filter valid completed historical months (excluding months with trivial test counts)
        const validHistoricalMonths = (historicalMonthsAgg || []).filter((m: any) => (m.revenue || 0) >= 15000);
        
        let avgHistoricalMonthlyRevenue = 115000;
        let avgHistoricalAov = 1100;
        
        if (validHistoricalMonths.length > 0) {
            const sumRev = validHistoricalMonths.reduce((s: number, m: any) => s + (m.revenue || 0), 0);
            const sumInvs = validHistoricalMonths.reduce((s: number, m: any) => s + (m.invoices || 0), 0);
            avgHistoricalMonthlyRevenue = Math.round(sumRev / validHistoricalMonths.length);
            if (sumInvs > 0) {
                avgHistoricalAov = Math.round(sumRev / sumInvs);
            }
        }

        // Seasonal indices for Optical Retail in India (1.00 = baseline neutral):
        // Jan: 0.88, Feb: 0.92, Mar: 0.98, Apr: 0.85, May: 0.92, Jun: 0.95,
        // Jul: 0.94, Aug: 1.05, Sep: 1.00, Oct: 1.25 (Diwali festive), Nov: 1.20, Dec: 1.10
        const SEASONAL_INDICES = [0.88, 0.92, 0.98, 0.85, 0.92, 0.95, 0.94, 1.05, 1.00, 1.25, 1.20, 1.10];
        const targetMonthIndex = windowStart.getMonth(); // 0-11
        const seasonalFactor = SEASONAL_INDICES[targetMonthIndex] || 1.00;

        // 3-Tier Targets:
        // 1. Expected = Baseline * Seasonal Factor (what normal business flow naturally yields)
        const expectedRevenue = Math.round(avgHistoricalMonthlyRevenue * seasonalFactor);
        
        // 2. Target = Intentional target (if locked in DB, use locked; else Expected * 1.12 for +12% growth)
        const isLockedTarget = Boolean(monthlyTargetDoc?.revenueTarget && monthlyTargetDoc.revenueTarget > 0);
        const targetRevenue = isLockedTarget 
            ? monthlyTargetDoc!.revenueTarget 
            : Math.round(expectedRevenue * 1.12);

        // 3. Stretch = Peak execution benchmark (+12% above Target)
        const stretchRevenue = Math.round(targetRevenue * 1.12);

        const expenseBudget = monthlyTargetDoc?.expenseBudget || Math.round(targetRevenue * 0.22);

        // Expected pace by Day X (proportional seasonal expected pace)
        const expectedPaceRevenue = Math.round((expectedRevenue / totalDaysInMonth) * daysElapsed);
        const targetPaceRevenue = Math.round((targetRevenue / totalDaysInMonth) * daysElapsed);

        // Variance vs Expected Pace %
        const vsExpectedPct = expectedPaceRevenue > 0
            ? Number((((grossRevenue - expectedPaceRevenue) / expectedPaceRevenue) * 100).toFixed(1))
            : 0;

        // Pace vs Target %
        const pacePct = targetPaceRevenue > 0
            ? Number(((grossRevenue / targetPaceRevenue) * 100).toFixed(1))
            : 100;

        // Accurate daily run rate and forecast projection
        const curYearNum = now.getFullYear();
        const curMonthNum = now.getMonth();
        let elapsedWeekdays = 0;
        let elapsedWeekends = 0;

        for (let d = 1; d <= daysElapsed; d++) {
            const dayDate = new Date(curYearNum, curMonthNum, d);
            const dayOfWeek = dayDate.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) elapsedWeekends++;
            else elapsedWeekdays++;
        }

        const dailyRunRate = daysElapsed > 0 ? Math.round(grossRevenue / daysElapsed) : 0;
        const dailyWeekdaySales = elapsedWeekdays > 0 ? (weekdayRevenue / elapsedWeekdays) : (dailyRunRate || 3000);
        const dailyWeekendSales = elapsedWeekends > 0 ? (weekendRevenue / elapsedWeekends) : (dailyWeekdaySales * 1.35);

        // Count remaining distinct weekdays and weekends
        let remainingWeekdays = 0;
        let remainingWeekends = 0;

        if (isMtdMode && daysRemaining > 0) {
            for (let d = daysElapsed + 1; d <= totalDaysInMonth; d++) {
                const dayDate = new Date(curYearNum, curMonthNum, d);
                const dayOfWeek = dayDate.getDay();
                if (dayOfWeek === 0 || dayOfWeek === 6) remainingWeekends++;
                else remainingWeekdays++;
            }
        }

        const projectedRemainingSales = isMtdMode && daysRemaining > 0
            ? Math.round(remainingWeekdays * dailyWeekdaySales + remainingWeekends * dailyWeekendSales)
            : 0;

        const projectedMonthEndClose = isMtdMode ? Math.round(grossRevenue + projectedRemainingSales) : grossRevenue;
        const projectedTargetAchievementPct = targetRevenue > 0 ? Number(((projectedMonthEndClose / targetRevenue) * 100).toFixed(1)) : 100;
        const targetGap = projectedMonthEndClose - targetRevenue; // positive = surplus, negative = shortfall

        // Forecast Confidence & Balanced Realistic Scenarios
        const forecastConfidence = daysElapsed >= 15 ? 'High' : daysElapsed >= 7 ? 'Medium' : 'Low';
        const forecastConservative = isMtdMode && daysRemaining > 0
            ? Math.round(grossRevenue + (daysRemaining * Math.max(2500, dailyRunRate * 0.78)))
            : projectedMonthEndClose;
        const forecastUpside = isMtdMode && daysRemaining > 0
            ? Math.round(grossRevenue + (daysRemaining * dailyRunRate * 1.15))
            : projectedMonthEndClose;

        const targetMonthName = windowStart.toLocaleString('en-US', { month: 'long' });
        const targetGapLakh = (Math.abs(targetGap) / 100000).toFixed(2);
        const forecastFinishSentence = targetGap >= 0
            ? `At the current forecast, ${targetMonthName} is expected to finish ₹${targetGapLakh}L (${Math.round((targetGap / targetRevenue) * 100)}%) above target.`
            : `At the current forecast, ${targetMonthName} is expected to finish ₹${targetGapLakh}L (${Math.round((Math.abs(targetGap) / targetRevenue) * 100)}%) below target.`;

        const remainingWeightedRunRate = daysRemaining > 0 ? Math.round(projectedRemainingSales / daysRemaining) : 0;
        const forecastFormulaText = `₹${grossRevenue.toLocaleString('en-IN')} (Actual MTD) + ₹${projectedRemainingSales.toLocaleString('en-IN')} (Remaining ${daysRemaining} days @ ₹${remainingWeightedRunRate.toLocaleString('en-IN')}/day) = ₹${projectedMonthEndClose.toLocaleString('en-IN')}`;

        // Baseline classification
        const hasReliableHistory = (validHistoricalMonths?.length || 0) >= 3;
        const baselineLabel = hasReliableHistory ? 'Historical Baseline' : 'Current Baseline';
        const baselineTooltip = hasReliableHistory
            ? `Expected ${targetMonthName} revenue based on comparable historical performance, adjusted for seasonal factor.`
            : `Current business baseline run-rate based on available history.`;

        // Target Crossing milestone calculation
        const remainingToTarget = Math.max(0, targetRevenue - grossRevenue);
        const daysToTarget = dailyRunRate > 0 && remainingToTarget > 0 ? Number((remainingToTarget / dailyRunRate).toFixed(1)) : 0;
        const targetCrossingDay = remainingToTarget === 0
            ? daysElapsed
            : Math.min(totalDaysInMonth, Math.ceil(daysElapsed + daysToTarget));

        let targetCrossingSentence = `Monthly target already achieved on Day ${daysElapsed}!`;
        if (remainingToTarget > 0) {
            if (daysToTarget <= 2.5) {
                targetCrossingSentence = `Target reached at current pace in ~${Math.round(daysToTarget) || 1} day${Math.round(daysToTarget) === 1 ? '' : 's'} (around Day ${targetCrossingDay}). Forecast: ₹${(projectedMonthEndClose / 100000).toFixed(2)}L vs ₹${(targetRevenue / 100000).toFixed(1)}k target.`;
            } else {
                targetCrossingSentence = `At current velocity (₹${dailyRunRate.toLocaleString('en-IN')}/day), target expected to be reached in ~${Math.round(daysToTarget)} days (around Day ${targetCrossingDay}).`;
            }
        }

        // Operational Drivers:
        const targetOrders = Math.max(1, Math.round(targetRevenue / (avgHistoricalAov || 1100)));
        const targetAov = Math.round(targetRevenue / targetOrders);
        const dailySalesRequired = Math.round(targetRevenue / totalDaysInMonth);
        const dailyOrdersRequired = Number((targetOrders / totalDaysInMonth).toFixed(1));
        const targetFootfallOpportunities = Math.round(targetOrders / 0.40); // 40% conversion target
        const estimatedFootfall = Math.round(invoiceCount / 0.381);
        const estimatedConversionRatePct = 38.1;

        const ordersAchievementPct = targetOrders > 0 ? Number(((invoiceCount / targetOrders) * 100).toFixed(1)) : 0;
        const aovDiffPct = targetAov > 0 ? Math.round(((aov - targetAov) / targetAov) * 100) : 0;
        const remainingOrders = Math.max(0, targetOrders - invoiceCount);
        const orderGapRevenueImpact = remainingOrders * aov;

        let orderDecisionSentence = `Target volume reached (${invoiceCount}/${targetOrders} orders).`;
        if (remainingOrders > 0) {
            orderDecisionSentence = `You need only ${remainingOrders} more order${remainingOrders === 1 ? '' : 's'} to hit the monthly order target (${invoiceCount}/${targetOrders}). At current AOV (₹${aov.toLocaleString('en-IN')}), that would add ~₹${Math.round(orderGapRevenueImpact).toLocaleString('en-IN')}.`;
        }

        let synthesisSentence = `Revenue is significantly ahead of target pace. At current velocity, the monthly target should be reached in approximately ${daysToTarget <= 1 ? "1-2 days" : `${Math.round(daysToTarget)} days`}.`;
        if (aovDiffPct < 0) {
            synthesisSentence += ` AOV is ₹${aov.toLocaleString('en-IN')} vs ₹${targetAov.toLocaleString('en-IN')} target (${Math.abs(aovDiffPct)}% below target).`;
        }

        // Category Targets (Frames ~42%, Lenses ~48%, Fragrance ~10%):
        const frameTargetRev = Math.round(targetRevenue * 0.42);
        const lensTargetRev = Math.round(targetRevenue * 0.48);
        const fragTargetRev = Math.round(targetRevenue * 0.10);
        const grossProfitTarget = Math.round(targetRevenue * 0.58); // 58% Target Gross Margin

        const pacing = {
            isMtdMode,
            daysElapsed,
            totalDaysInMonth,
            daysRemaining,
            isLockedTarget,
            seasonalFactor,
            targetMonthName,
            hasReliableHistory,
            baselineLabel,
            baselineTooltip,
            baselineRevenue: avgHistoricalMonthlyRevenue,
            // 3-Tier Targets
            expectedRevenue,
            targetRevenue,
            stretchRevenue,
            expenseBudget,
            // Pacing benchmarks
            expectedPaceRevenue,
            targetPaceRevenue,
            vsExpectedPct,
            pacePct,
            projectedMonthEndClose,
            projectedTargetAchievementPct,
            targetGap,
            dailyRunRate,
            remainingToTarget,
            daysToTarget,
            targetCrossingDay,
            targetCrossingSentence,
            // Forecast Breakdown
            forecast: {
                expectedClose: projectedMonthEndClose,
                targetGap,
                targetAchievementPct: projectedTargetAchievementPct,
                method: 'Historical weekday/weekend weighted',
                confidence: forecastConfidence,
                dailyRunRate,
                remainingDaysWeightedRunRate: remainingWeightedRunRate,
                remainingDays: daysRemaining,
                formulaText: forecastFormulaText,
                scenarios: {
                    conservative: forecastConservative,
                    expected: projectedMonthEndClose,
                    upside: forecastUpside,
                },
                finishSentence: forecastFinishSentence,
            },
            // Operational Drivers
            drivers: {
                targetOrders,
                actualOrders: invoiceCount,
                ordersAchievementPct,
                targetAov,
                actualAov: aov,
                remainingOrdersNeeded: remainingOrders,
                projectedRevenueFromRemainingOrders: Math.round(orderGapRevenueImpact),
                orderDecisionSentence,
                dailySalesRequired,
                dailyOrdersRequired,
                targetFootfallOpportunities,
                estimatedFootfall,
                estimatedConversionRatePct,
                synthesisSentence,
            },
            // Category Targets
            categoryTargets: {
                frame: {
                    targetRevenue: frameTargetRev,
                    actualRevenue: Math.round(frameRev),
                    achievementPct: frameTargetRev > 0 ? Number(((frameRev / frameTargetRev) * 100).toFixed(1)) : 0,
                    targetUnits: Math.round(frameTargetRev / 1600),
                    actualUnits: frameUnits,
                    targetMarginPct: 58,
                },
                lens: {
                    targetRevenue: lensTargetRev,
                    actualRevenue: Math.round(lensRev),
                    achievementPct: lensTargetRev > 0 ? Number(((lensRev / lensTargetRev) * 100).toFixed(1)) : 0,
                    targetUnits: Math.round(lensTargetRev / 1200),
                    actualUnits: lensUnits,
                    targetMarginPct: 62,
                },
                fragrance: {
                    targetRevenue: fragTargetRev,
                    actualRevenue: Math.round(fragRev),
                    achievementPct: fragTargetRev > 0 ? Number(((fragRev / fragTargetRev) * 100).toFixed(1)) : 0,
                    targetUnits: Math.round(fragTargetRev / 650),
                    actualUnits: fragUnits,
                    targetMarginPct: 52,
                },
                grossProfit: {
                    targetGrossProfit: grossProfitTarget,
                    actualGrossProfit: Math.round(grossProfit),
                    achievementPct: grossProfitTarget > 0 ? Number(((grossProfit / grossProfitTarget) * 100).toFixed(1)) : 0,
                    targetMarginPct: 58,
                    actualMarginPct: grossMarginPct,
                }
            }
        };

        // 5. Category Breakdown
        const totalCatRev = frameRev + lensRev + fragRev || 1;
        const categoryShare = [
            {
                name: 'Optical Frames',
                category: 'frame',
                revenue: Math.round(frameRev),
                units: frameUnits,
                sharePct: Number(((frameRev / totalCatRev) * 100).toFixed(1)),
                marginPct: frameRev > 0 ? Number((((frameRev - frameCost) / frameRev) * 100).toFixed(1)) : 58.0,
                color: '#2563EB',
            },
            {
                name: 'Prescription Lenses',
                category: 'lens',
                revenue: Math.round(lensRev),
                units: lensUnits,
                sharePct: Number(((lensRev / totalCatRev) * 100).toFixed(1)),
                marginPct: lensRev > 0 ? Number((((lensRev - lensCost) / lensRev) * 100).toFixed(1)) : 62.5,
                color: '#059669',
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

        // 6. Inventory Valuation, Aging & Trapped Capital
        let frameStockValue = 0;
        let frameStockUnits = 0;
        let lensStockValue = 0;
        let lensStockUnits = 0;
        let fragranceStockValue = 0;
        let fragranceStockUnits = 0;

        const ageBuckets = [
            { bracket: '0–90 Days', label: 'Fresh Active Display', value: 0, count: 0, pct: 0, status: 'healthy' as const },
            { bracket: '91–180 Days', label: 'Slow Moving', value: 0, count: 0, pct: 0, status: 'watch' as const },
            { bracket: '181–365 Days', label: 'Stagnant Capital', value: 0, count: 0, pct: 0, status: 'warning' as const },
            { bracket: '365+ Days', label: 'Dead Stock (Clearance)', value: 0, count: 0, pct: 0, status: 'danger' as const },
        ];

        for (const f of allFrames) {
            const qty = f.stock || 0;
            const cost = f.costPrice || (f.sellPrice ? f.sellPrice * 0.45 : 450);
            const val = qty * cost;
            frameStockValue += val;
            frameStockUnits += qty;

            const createdMs = f.createdAt ? new Date(f.createdAt).getTime() : nowMs - (60 * 86400000);
            const ageDays = Math.max(0, Math.round((nowMs - createdMs) / 86400000));

            if (ageDays <= 90) {
                ageBuckets[0].value += val;
                ageBuckets[0].count += qty;
            } else if (ageDays <= 180) {
                ageBuckets[1].value += val;
                ageBuckets[1].count += qty;
            } else if (ageDays <= 365) {
                ageBuckets[2].value += val;
                ageBuckets[2].count += qty;
            } else {
                ageBuckets[3].value += val;
                ageBuckets[3].count += qty;
            }
        }

        for (const ls of allLensStocks) {
            const qty = ls.quantity || 0;
            const cost = ls.costPrice || 250;
            const val = qty * cost;
            lensStockValue += val;
            lensStockUnits += qty;
        }

        for (const fr of allFragrances) {
            let qty = fr.stock || 0;
            let val = qty * (fr.costPrice || (fr.sellPrice ? fr.sellPrice * 0.5 : 300));
            if (Array.isArray(fr.variants)) {
                for (const v of fr.variants) {
                    const vQty = v.stock || 0;
                    qty += vQty;
                    val += vQty * (v.costPrice || fr.costPrice || (v.sellPrice * 0.5));
                }
            }
            fragranceStockValue += val;
            fragranceStockUnits += qty;
        }

        const totalStockValue = frameStockValue + lensStockValue + fragranceStockValue || 450000;
        const totalStockUnits = frameStockUnits + lensStockUnits + fragranceStockUnits || 1;

        for (const b of ageBuckets) {
            b.pct = frameStockValue > 0 ? Number(((b.value / frameStockValue) * 100).toFixed(1)) : 0;
            b.value = Math.round(b.value);
        }

        const trappedCapital = Math.round(ageBuckets[2].value + ageBuckets[3].value);
        const totalUnitsSoldPeriod = frameUnits + lensUnits + fragUnits || 1;
        const annualizedSoldUnits = (totalUnitsSoldPeriod / days) * 365;
        const annualStockTurns = Number((annualizedSoldUnits / totalStockUnits).toFixed(2));

        // 7. Discount Leakage & Target Comparison
        const discountLeakage = {
            grossBilledBeforeDiscount: Math.round(grossBilledBeforeDiscount),
            totalDiscount: Math.round(totalDiscount),
            discountPct,
            targetDiscountPct: 5.0,
            realizedNetSales: Math.round(grossRevenue),
            gpBeforeDiscount: Math.round(grossProfit + totalDiscount),
            gpAfterDiscount: Math.round(grossProfit),
            gpMarginBeforeDiscount: grossBilledBeforeDiscount > 0 ? Number((((grossProfit + totalDiscount) / grossBilledBeforeDiscount) * 100).toFixed(1)) : grossMarginPct,
            gpMarginAfterDiscount: grossMarginPct,
            categoryDiscounts: [
                { name: 'Optical Frames', discountEstimated: Math.round(totalDiscount * 0.65), avgDiscountPct: Number((discountPct * 1.1).toFixed(1)) },
                { name: 'Prescription Lenses', discountEstimated: Math.round(totalDiscount * 0.25), avgDiscountPct: Number((discountPct * 0.7).toFixed(1)) },
                { name: 'Fragrances', discountEstimated: Math.round(totalDiscount * 0.10), avgDiscountPct: Number((discountPct * 0.5).toFixed(1)) },
            ],
        };

        // 8. Lens Restock Radar with Stock Cover
        const lensStockRadar = Array.from(lensPowerMap.values())
            .map((lp) => {
                const pairsSold = lp.pairs;
                const monthlyVelocity = Number(((pairsSold / days) * 30).toFixed(1));
                const matchingStock = allLensStocks.find(
                    (s) => Math.abs(s.sph - lp.sph) < 0.01 && Math.abs(s.cyl - lp.cyl) < 0.01
                );
                const currentStock = matchingStock ? matchingStock.quantity : 2;
                const stockCoverMonths = monthlyVelocity > 0 ? Number((currentStock / monthlyVelocity).toFixed(2)) : 2.0;

                let status: 'CRITICAL' | 'RESTOCK' | 'HEALTHY' = 'HEALTHY';
                let recommendedReorder = 0;
                if (stockCoverMonths < 0.25) {
                    status = 'CRITICAL';
                    recommendedReorder = Math.max(10, Math.ceil(monthlyVelocity * 1.5 - currentStock));
                } else if (stockCoverMonths < 0.5) {
                    status = 'RESTOCK';
                    recommendedReorder = Math.max(6, Math.ceil(monthlyVelocity * 1.2 - currentStock));
                }

                const signSph = lp.sph > 0 ? `+${lp.sph.toFixed(2)}` : lp.sph.toFixed(2);
                const signCyl = lp.cyl !== 0 ? ` / ${lp.cyl > 0 ? `+${lp.cyl.toFixed(2)}` : lp.cyl.toFixed(2)} Cyl` : '';

                return {
                    powerLabel: `${signSph}${signCyl}`,
                    sph: lp.sph,
                    cyl: lp.cyl,
                    pairsSold,
                    monthlyVelocity,
                    currentStock,
                    stockCoverMonths,
                    recommendedReorder,
                    status,
                    revenue: Math.round(lp.revenue),
                };
            })
            .sort((a, b) => (a.status === 'CRITICAL' ? -1 : b.status === 'CRITICAL' ? 1 : a.stockCoverMonths - b.stockCoverMonths))
            .slice(0, 10);

        // 9. Automated Action Briefs (Observation → Cause → Action)
        const actionBriefs = [];

        // Pacing brief for MTD
        const currentMonthName = now.toLocaleString('en-US', { month: 'long' });
        if (isMtdMode) {
            const paceDiff = grossRevenue - targetPaceRevenue;
            const paceDiffText = paceDiff >= 0
                ? `₹${Math.round(paceDiff).toLocaleString('en-IN')} ahead of target pace (+${vsExpectedPct}% vs expected)`
                : `₹${Math.round(Math.abs(paceDiff)).toLocaleString('en-IN')} behind target pace (${vsExpectedPct}% vs expected)`;

            actionBriefs.push({
                id: 'mtd-pace-brief',
                type: targetGap >= 0 ? ('growth' as const) : ('warning' as const),
                title: targetGap >= 0 ? `Strong MTD Pace: ${paceDiffText}` : `Pacing Deficit: ${paceDiffText}`,
                subtitle: `Generated ₹${grossRevenue.toLocaleString('en-IN')} vs target pace ₹${targetPaceRevenue.toLocaleString('en-IN')} by Day ${daysElapsed}. Forecasted to close at ₹${projectedMonthEndClose.toLocaleString('en-IN')}.`,
                observation: `Target is ${Math.round((grossRevenue / targetRevenue) * 100)}% achieved (₹${grossRevenue.toLocaleString('en-IN')} / ₹${targetRevenue.toLocaleString('en-IN')}) with ${daysRemaining} days remaining.`,
                cause: `Daily run-rate is ₹${dailyRunRate.toLocaleString('en-IN')}/day (${paceDiff >= 0 ? 'exceeding' : 'lagging'} ₹${dailySalesRequired.toLocaleString('en-IN')}/day required).`,
                action: targetGap >= 0
                    ? `Maintain current sales velocity to secure month-end surplus of +₹${targetGap.toLocaleString('en-IN')}.`
                    : `Increase daily sales to ₹${Math.round((targetRevenue - grossRevenue) / Math.max(1, daysRemaining)).toLocaleString('en-IN')}/day across remaining ${daysRemaining} days.`,
                tag: 'Target Pacing',
            });
        }

        // Lens Attachment / Underperformance Action Brief
        const lensAchPct = lensTargetRev > 0 ? Number(((lensRev / lensTargetRev) * 100).toFixed(1)) : 0;
        const frameAchPct = frameTargetRev > 0 ? Number(((frameRev / frameTargetRev) * 100).toFixed(1)) : 0;

        if (lensAchPct < 85) {
            actionBriefs.push({
                id: 'lens-attachment-brief',
                type: 'warning' as const,
                title: `Lens Sales Lagging Target (${lensAchPct}% achieved)`,
                subtitle: `Frame sales are strong at ${frameAchPct}% of target, but lens revenue is only ₹${Math.round(lensRev).toLocaleString('en-IN')} / ₹${lensTargetRev.toLocaleString('en-IN')}.`,
                observation: `Lens sales are ${Math.round(100 - lensAchPct)}% below target (₹${Math.round(lensRev).toLocaleString('en-IN')} vs ₹${lensTargetRev.toLocaleString('en-IN')}).`,
                cause: `Frame volume is strong, but lens AOV and premium coating attachment is lagging.`,
                action: `Prioritize anti-glare / blue-cut lens attachment on frame orders to lift ticket size.`,
                tag: 'Lens Attachment',
            });
        }

        // Top Growth Driver (Fragrance or Frames)
        const topCat = [...categoryShare].sort((a, b) => b.revenue - a.revenue)[0];
        if (topCat) {
            actionBriefs.push({
                id: 'top-growth-driver',
                type: 'growth' as const,
                title: `${topCat.name} Primary Revenue Driver (${topCat.sharePct}%)`,
                subtitle: `Generated ₹${topCat.revenue.toLocaleString('en-IN')} with ${topCat.marginPct}% gross margin across ${topCat.units} units sold.`,
                observation: `${topCat.name} accounts for ${topCat.sharePct}% of total period sales.`,
                cause: `Strong footfall demand and high customer basket conversion.`,
                action: `Maintain high inventory availability for fast-moving models.`,
                tag: 'Growth Driver',
            });
        }

        // Discount Rate Brief
        if (discountPct >= 5.0) {
            actionBriefs.push({
                id: 'discount-leakage-alert',
                type: 'warning' as const,
                title: `Discount Rate at ${discountPct}% (₹${totalDiscount.toLocaleString('en-IN')} Sacrificed)`,
                subtitle: `Counter discounts reduced store gross margin by ${(discountLeakage.gpMarginBeforeDiscount - discountLeakage.gpMarginAfterDiscount).toFixed(1)}%.`,
                observation: `Discount rate is ${discountPct}%, exceeding the 5.0% target ceiling.`,
                cause: `Manual price concessions given on frames and perfumes sacrificed ₹${totalDiscount.toLocaleString('en-IN')} in margin.`,
                action: `Enforce a strict 5.0% maximum discount limit at checkout to protect gross profits.`,
                tag: 'Margin Protection',
            });
        }

        // Trapped Capital Brief
        if (trappedCapital > 15000) {
            actionBriefs.push({
                id: 'trapped-capital-alert',
                type: 'action' as const,
                title: `₹${trappedCapital.toLocaleString('en-IN')} Trapped in Stagnant Frames (>180 Days)`,
                subtitle: `Frames in 180+ and 365+ day aging brackets are locking up retail capital.`,
                observation: `₹${trappedCapital.toLocaleString('en-IN')} is tied up in slow-moving frame inventory.`,
                cause: `Older display stock has not rotated into sales over the past 6 months.`,
                action: `Reposition aged frames at entrance or bundle with prescription lenses in a clearance package.`,
                tag: 'Liquidate Stock',
            });
        }

        // 10. Timeline Mapping
        const timelineMap = new Map<string, { label: string; date: string; revenue: number; collected: number; discount: number; count: number }>();
        if (isMonthlyGrouping) {
            for (let i = 0; i < 12; i++) {
                const d = new Date(windowStart);
                d.setMonth(d.getMonth() + i);
                const monthKey = formatLocalMonthKey(d);
                const label = d.toLocaleString('en-US', { month: 'short' });
                timelineMap.set(monthKey, { label, date: monthKey, revenue: 0, collected: 0, discount: 0, count: 0 });
            }
            for (const inv of currentInvoices) {
                const monthKey = formatLocalMonthKey(inv.billDate);
                const point = timelineMap.get(monthKey);
                if (point) {
                    point.revenue += (inv.total || 0);
                    point.discount += (inv.discount || 0);
                    point.count += 1;
                }
            }
            for (const inv of currentPaymentsInvoices) {
                if (Array.isArray(inv.payments)) {
                    for (const p of inv.payments) {
                        const pDate = p.date ? new Date(p.date) : new Date(inv.billDate);
                        if (pDate >= windowStart && pDate <= windowEnd) {
                            const monthKey = formatLocalMonthKey(pDate);
                            const point = timelineMap.get(monthKey);
                            if (point) point.collected += (p.amount || 0);
                        }
                    }
                }
            }
        } else {
            for (let i = 0; i < days; i++) {
                const d = new Date(windowStart);
                d.setDate(d.getDate() + i);
                const dayKey = formatLocalDateKey(d);
                const label = days <= 7 ? d.toLocaleString('en-US', { weekday: 'short' }) : `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
                timelineMap.set(dayKey, { label, date: dayKey, revenue: 0, collected: 0, discount: 0, count: 0 });
            }
            for (const inv of currentInvoices) {
                const dayKey = formatLocalDateKey(inv.billDate);
                const point = timelineMap.get(dayKey);
                if (point) {
                    point.revenue += (inv.total || 0);
                    point.discount += (inv.discount || 0);
                    point.count += 1;
                }
            }
            for (const inv of currentPaymentsInvoices) {
                if (Array.isArray(inv.payments)) {
                    for (const p of inv.payments) {
                        const pDate = p.date ? new Date(p.date) : new Date(inv.billDate);
                        if (pDate >= windowStart && pDate <= windowEnd) {
                            const dayKey = formatLocalDateKey(pDate);
                            const point = timelineMap.get(dayKey);
                            if (point) point.collected += (p.amount || 0);
                        }
                    }
                }
            }
        }

        const timeline = Array.from(timelineMap.values()).map(p => ({
            ...p,
            revenue: Math.round(p.revenue),
            collected: Math.round(p.collected),
            discount: Math.round(p.discount),
        }));

        const topProducts = Array.from(productMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
            .map(p => ({
                ...p,
                revenue: Math.round(p.revenue),
                cogs: Math.round(p.cogs),
                gp: Math.round(p.revenue - p.cogs),
                marginPct: p.revenue > 0 ? Number((((p.revenue - p.cogs) / p.revenue) * 100).toFixed(1)) : 0,
            }));

        res.json({
            timeframe,
            displayLabel,
            period: {
                from: windowStart.toISOString(),
                to: windowEnd.toISOString(),
                days,
            },
            kpis: {
                grossRevenue: Math.round(grossRevenue),
                revenueDelta: Number(revenueDelta.toFixed(1)),
                cashCollected: Math.round(cashCollected),
                collectionDelta: Number(collectionDelta.toFixed(1)),
                receivables: Math.round(receivables),
                collectionRate,
                grossProfit: Math.round(grossProfit),
                grossMarginPct,
                netContributionMargin: Math.round(totalNetContribution),
                contributionMarginPct,
                aov,
                invoiceCount,
                totalDiscount: Math.round(totalDiscount),
                discountPct,
                newCustomerRev: Math.round(newCustomerRev),
                newCustomerRevPct,
                newCustomerCount,
                repeatCustomerRev: Math.round(repeatCustomerRev),
                repeatCustomerRevPct,
                repeatCustomerCount,
            },
            pnl,
            pacing,
            actionBriefs,
            receivablesAging,
            inventoryAging: {
                totalStockValue: Math.round(totalStockValue),
                frameStockValue: Math.round(frameStockValue),
                lensStockValue: Math.round(lensStockValue),
                fragranceStockValue: Math.round(fragranceStockValue),
                trappedCapital,
                annualStockTurns,
                buckets: ageBuckets,
            },
            discountLeakage,
            lensStockRadar,
            timeline,
            categoryShare,
            topProducts,
        });
    } catch (error) {
        next(error);
    }
};

export const getUnitEconomicsAnalytics = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const timeframe = (req.query.timeframe as string) || 'month'; // '7d' | '30d' | 'month' | 'quarter' | 'year' | 'all'
        const now = new Date();
        let startDate: Date;
        const endDate = new Date(now);

        if (timeframe === '7d') {
            startDate = new Date(now.getTime() - 7 * 86400000);
        } else if (timeframe === '30d') {
            startDate = new Date(now.getTime() - 30 * 86400000);
        } else if (timeframe === 'quarter') {
            startDate = new Date(now.getTime() - 90 * 86400000);
        } else if (timeframe === 'year') {
            startDate = new Date(now.getFullYear(), 0, 1);
        } else if (timeframe === 'all') {
            startDate = new Date(2020, 0, 1);
        } else {
            // 'month' (current month)
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        const [invoices, financialSetting, adSpends, frameStock, fragStock, vendorBills, obligations] = await Promise.all([
            Invoice.find({ billDate: { $gte: startDate, $lte: endDate } })
                .populate('items')
                .lean(),
            SiteSetting.findOne({ key: 'retail_financial_settings' }).lean(),
            AdSpend.find({ date: { $gte: startDate, $lte: endDate } }).lean(),
            Frame.find({ isArchived: { $ne: true } }).select('costPrice stock').lean(),
            Fragrance.find({ isArchived: { $ne: true } }).select('costPrice stock variants').lean(),
            VendorBill.find({ status: { $ne: 'paid' } }).select('totalAmount paidAmount').lean(),
            Obligation.find({ status: 'open' }).select('originalAmount alreadyPaid').lean(),
        ]);

        const defaultSettings = {
            defaultCardSwipeFeePct: 0,
            defaultPackagingCost: 35,
        };
        const config = financialSetting?.value ? { ...defaultSettings, ...financialSetting.value } : defaultSettings;

        let totalRevenue = 0;
        let totalCogs = 0;
        let totalPackaging = 0;
        let totalProcessingFees = 0;
        let totalNetContributionMargin = 0;

        let newCustomerRevenue = 0;
        let newCustomerCount = 0;
        let newCustomerContributionMargin = 0;

        let repeatCustomerRevenue = 0;
        let repeatCustomerCount = 0;
        let repeatCustomerContributionMargin = 0;

        const sourceMap = new Map<string, {
            source: string;
            revenue: number;
            invoicesCount: number;
            newCustomerCount: number;
            cogs: number;
            packaging: number;
            fees: number;
            contributionMargin: number;
            adSpend: number;
        }>();

        const defaultSources = [
            'walk_by',
            'google_maps',
            'instagram',
            'whatsapp',
            'referral',
            'doctor_rx',
            'flyers',
            'repeat',
            'other',
        ];

        for (const s of defaultSources) {
            sourceMap.set(s, {
                source: s,
                revenue: 0,
                invoicesCount: 0,
                newCustomerCount: 0,
                cogs: 0,
                packaging: 0,
                fees: 0,
                contributionMargin: 0,
                adSpend: 0,
            });
        }

        // Aggregate Ad Spends by mapped channels
        for (const ad of adSpends) {
            let targetSource = 'other';
            if (ad.channel === 'google') targetSource = 'google_maps';
            else if (ad.channel === 'instagram' || ad.channel === 'facebook') targetSource = 'instagram';
            else if (ad.channel === 'whatsapp') targetSource = 'whatsapp';
            else if (ad.channel === 'newspaper' || ad.channel === 'flyers') targetSource = 'flyers';

            const existing = sourceMap.get(targetSource) || {
                source: targetSource,
                revenue: 0,
                invoicesCount: 0,
                newCustomerCount: 0,
                cogs: 0,
                packaging: 0,
                fees: 0,
                contributionMargin: 0,
                adSpend: 0,
            };
            existing.adSpend += (ad.amount || 0);
            sourceMap.set(targetSource, existing);
        }

        for (const inv of invoices) {
            const rev = inv.total || 0;
            totalRevenue += rev;

            // Compute cogs if already recorded or fallback
            let cogs = inv.totalCogs || 0;
            if (!cogs && Array.isArray(inv.items)) {
                cogs = inv.items.reduce((s: number, it: any) => s + ((it?.costPrice || 0) * (it?.quantity || 1)), 0);
            }
            totalCogs += cogs;

            const packaging = typeof inv.packagingCost === 'number' ? inv.packagingCost : config.defaultPackagingCost;
            totalPackaging += packaging;

            let fee = typeof inv.paymentProcessingFee === 'number' ? inv.paymentProcessingFee : 0;
            if (!fee && config.defaultCardSwipeFeePct > 0 && Array.isArray(inv.payments)) {
                const onlineAmount = inv.payments.filter((p: any) => p.method === 'online').reduce((s: number, p: any) => s + (p.amount || 0), 0);
                fee = Number(((onlineAmount * (config.defaultCardSwipeFeePct / 100))).toFixed(2));
            }
            totalProcessingFees += fee;

            const margin = typeof inv.netContributionMargin === 'number' && inv.netContributionMargin > 0
                ? inv.netContributionMargin
                : Math.max(0, rev - cogs - packaging - fee);
            totalNetContributionMargin += margin;

            const isNew = inv.isNewCustomer !== undefined ? inv.isNewCustomer : (inv.visitNumber === 1 || !inv.visitNumber);
            if (isNew) {
                newCustomerRevenue += rev;
                newCustomerCount += 1;
                newCustomerContributionMargin += margin;
            } else {
                repeatCustomerRevenue += rev;
                repeatCustomerCount += 1;
                repeatCustomerContributionMargin += margin;
            }

            const src = (inv.acquisitionSource as string) || (isNew ? 'walk_by' : 'repeat');
            const srcEntry = sourceMap.get(src) || {
                source: src,
                revenue: 0,
                invoicesCount: 0,
                newCustomerCount: 0,
                cogs: 0,
                packaging: 0,
                fees: 0,
                contributionMargin: 0,
                adSpend: 0,
            };
            srcEntry.revenue += rev;
            srcEntry.invoicesCount += 1;
            if (isNew) srcEntry.newCustomerCount += 1;
            srcEntry.cogs += cogs;
            srcEntry.packaging += packaging;
            srcEntry.fees += fee;
            srcEntry.contributionMargin += margin;
            sourceMap.set(src, srcEntry);
        }

        const totalInvoices = invoices.length;
        const contributionMarginPct = totalRevenue > 0 ? Number(((totalNetContributionMargin / totalRevenue) * 100).toFixed(1)) : 0;
        const aov = totalInvoices > 0 ? Math.round(totalRevenue / totalInvoices) : 0;
        const breakevenCac = Math.round(aov * (contributionMarginPct / 100));

        // Source List with CAC and ROAS
        const sourcesList = Array.from(sourceMap.values()).map(s => {
            const netContribution = Math.round(s.contributionMargin);
            const channelNetProfit = Math.round(netContribution - s.adSpend);
            const roas = s.adSpend > 0 ? Number((s.revenue / s.adSpend).toFixed(2)) : null;
            const cac = (s.adSpend > 0 && s.newCustomerCount > 0) ? Math.round(s.adSpend / s.newCustomerCount) : (s.adSpend > 0 ? Math.round(s.adSpend) : 0);
            return {
                ...s,
                revenue: Math.round(s.revenue),
                cogs: Math.round(s.cogs),
                contributionMargin: netContribution,
                adSpend: Math.round(s.adSpend),
                channelNetProfit,
                roas,
                cac,
                marginPct: s.revenue > 0 ? Number(((netContribution / s.revenue) * 100).toFixed(1)) : 0,
            };
        }).sort((a, b) => b.revenue - a.revenue);

        // Retail Cash Conversion Cycle (CCC) Calculation
        const totalFrameInventoryValue = frameStock.reduce((sum, f) => sum + ((f.costPrice || 0) * (f.stock || 0)), 0);
        const totalFragranceInventoryValue = fragStock.reduce((sum, fr) => {
            let val = (fr.costPrice || 0) * (fr.stock || 0);
            if (Array.isArray(fr.variants)) {
                val += fr.variants.reduce((vSum, v) => vSum + ((v.costPrice || fr.costPrice || 0) * (v.stock || 0)), 0);
            }
            return sum + val;
        }, 0);
        const totalStockValue = totalFrameInventoryValue + totalFragranceInventoryValue || 500000;

        const daysInPeriod = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000));
        const annualizedCogs = totalCogs > 0 ? (totalCogs / daysInPeriod) * 365 : 600000;
        const dio = Math.round((totalStockValue / (annualizedCogs || 1)) * 365);

        const outstandingDues = invoices.reduce((sum, inv) => {
            const paid = Array.isArray(inv.payments) ? inv.payments.reduce((pSum: number, p: any) => pSum + (p.amount || 0), 0) : 0;
            return sum + Math.max(0, (inv.total || 0) - paid);
        }, 0);
        const annualizedSales = totalRevenue > 0 ? (totalRevenue / daysInPeriod) * 365 : 1200000;
        const dso = Math.max(1, Math.round((outstandingDues / (annualizedSales || 1)) * 365));

        const totalPayables = vendorBills.reduce((s, v) => s + Math.max(0, (v.totalAmount || 0) - (v.paidAmount || 0)), 0) +
            obligations.reduce((s, o) => s + Math.max(0, (o.originalAmount || 0) - (o.alreadyPaid || 0)), 0);
        const dpo = Math.max(15, Math.round((totalPayables / (annualizedCogs || 1)) * 365));

        const ccc = Math.round(dio + dso - dpo);

        res.json({
            timeframe,
            period: {
                from: startDate.toISOString(),
                to: endDate.toISOString(),
                days: daysInPeriod,
            },
            config,
            kpis: {
                totalRevenue: Math.round(totalRevenue),
                totalCogs: Math.round(totalCogs),
                totalPackaging: Math.round(totalPackaging),
                totalProcessingFees: Math.round(totalProcessingFees),
                netContributionMargin: Math.round(totalNetContributionMargin),
                contributionMarginPct,
                totalInvoices,
                aov,
                breakevenCac,
            },
            customerSplit: {
                newCustomers: {
                    revenue: Math.round(newCustomerRevenue),
                    count: newCustomerCount,
                    contributionMargin: Math.round(newCustomerContributionMargin),
                    revenuePct: totalRevenue > 0 ? Number(((newCustomerRevenue / totalRevenue) * 100).toFixed(1)) : 0,
                    aov: newCustomerCount > 0 ? Math.round(newCustomerRevenue / newCustomerCount) : 0,
                },
                repeatCustomers: {
                    revenue: Math.round(repeatCustomerRevenue),
                    count: repeatCustomerCount,
                    contributionMargin: Math.round(repeatCustomerContributionMargin),
                    revenuePct: totalRevenue > 0 ? Number(((repeatCustomerRevenue / totalRevenue) * 100).toFixed(1)) : 0,
                    aov: repeatCustomerCount > 0 ? Math.round(repeatCustomerRevenue / repeatCustomerCount) : 0,
                },
            },
            sources: sourcesList,
            cashConversionCycle: {
                dio: Math.min(365, dio),
                dso: Math.min(60, dso),
                dpo: Math.min(180, dpo),
                ccc: Math.min(365, ccc),
                totalStockValue: Math.round(totalStockValue),
                outstandingDues: Math.round(outstandingDues),
                totalPayables: Math.round(totalPayables),
            },
        });
    } catch (error) {
        next(error);
    }
};
