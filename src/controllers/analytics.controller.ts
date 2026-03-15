import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';

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
        
        // Revenue by category (All time for now, or match month? User didn't specify overhauling these, but I'll keep them)
        const frameItems = await InvoiceItem.aggregate([
            { $match: { frame: { $exists: true, $ne: null } } },
            { $group: { _id: null, revenue: { $sum: { $multiply: ['$quantity', '$price'] } }, itemCount: { $sum: '$quantity' } } },
        ]);
        const lensItems = await InvoiceItem.aggregate([
            { $match: { opticalLens: { $exists: true, $ne: null } } },
            { $group: { _id: null, revenue: { $sum: { $multiply: ['$quantity', '$price'] } }, itemCount: { $sum: '$quantity' } } },
        ]);
        const fragItems = await InvoiceItem.aggregate([
            { $match: { fragrance: { $exists: true, $ne: null } } },
            { $group: { _id: null, revenue: { $sum: { $multiply: ['$quantity', '$price'] } }, itemCount: { $sum: '$quantity' } } },
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
