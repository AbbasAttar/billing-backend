import { Request, Response, NextFunction } from 'express';
import { Invoice } from '../models/Invoice.model';

const startOfDay = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
};

const addDays = (date: Date, days: number) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

const parseReferenceDate = (queryDate?: string) => {
    if (!queryDate) return new Date();
    const parsed = new Date(queryDate);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

// GET /api/sales/intelligence
export const getSalesIntelligence = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const referenceDate = parseReferenceDate(req.query.date as string);
        const windowDays = clamp(Number(req.query.windowDays) || 30, 7, 90);

        const windowStart = startOfDay(addDays(referenceDate, -(windowDays - 1)));
        const prevWindowStart = startOfDay(addDays(windowStart, -windowDays));
        const prevWindowEnd = new Date(windowStart.getTime() - 1);

        const [currentInvoices, prevInvoices] = await Promise.all([
            Invoice.find({ billDate: { $gte: windowStart, $lte: referenceDate } })
                .select({ subtotal: 1, discount: 1, total: 1, payments: 1, billDate: 1, billClearDate: 1, customer: 1 })
                .populate('customer', 'name')
                .lean(),
            Invoice.find({ billDate: { $gte: prevWindowStart, $lte: prevWindowEnd } })
                .select({ subtotal: 1, discount: 1, total: 1, payments: 1 })
                .lean(),
        ]);

        const getPaidAmount = (inv: any) =>
            Array.isArray(inv.payments) ? inv.payments.reduce((s: number, p: any) => s + (p.amount || 0), 0) : 0;

        // Revenue
        const grossRevenue = currentInvoices.reduce((s, inv) => s + (inv.total || 0), 0);
        const prevGrossRevenue = prevInvoices.reduce((s, inv) => s + (inv.total || 0), 0);
        const revenueDelta = prevGrossRevenue > 0 ? ((grossRevenue - prevGrossRevenue) / prevGrossRevenue) * 100 : 0;

        const totalCollected = currentInvoices.reduce((s, inv) => s + getPaidAmount(inv), 0);
        const collectionEfficiency = grossRevenue > 0 ? (totalCollected / grossRevenue) * 100 : 0;

        const outstandingReceivables = currentInvoices.reduce((s, inv) => {
            if (inv.billClearDate) return s;
            return s + Math.max((inv.total || 0) - getPaidAmount(inv), 0);
        }, 0);

        // Discounts
        const totalDiscount = currentInvoices.reduce((s, inv) => s + (inv.discount || 0), 0);
        const totalSubtotal = currentInvoices.reduce((s, inv) => s + (inv.subtotal || inv.total || 0), 0);
        const discountRatio = totalSubtotal > 0 ? (totalDiscount / totalSubtotal) * 100 : 0;
        const excessiveDiscountInvoices = currentInvoices.filter(inv => {
            const sub = inv.subtotal || inv.total || 0;
            return sub > 0 && (inv.discount || 0) / sub > 0.2;
        });

        // Payment methods
        const cashCollected = currentInvoices.reduce((s, inv) =>
            s + (Array.isArray(inv.payments) ? inv.payments.filter((p: any) => p.method === 'cash').reduce((ps: number, p: any) => ps + p.amount, 0) : 0), 0);
        const onlineCollected = currentInvoices.reduce((s, inv) =>
            s + (Array.isArray(inv.payments) ? inv.payments.filter((p: any) => p.method === 'online').reduce((ps: number, p: any) => ps + p.amount, 0) : 0), 0);

        // Invoice quality
        const invoiceCount = currentInvoices.length;
        const avgInvoiceValue = invoiceCount > 0 ? grossRevenue / invoiceCount : 0;
        const clearedCount = currentInvoices.filter(inv => inv.billClearDate).length;
        const creditSalesRatio = invoiceCount > 0 ? ((invoiceCount - clearedCount) / invoiceCount) * 100 : 0;
        const highValueInvoices = currentInvoices.filter(inv => (inv.total || 0) >= 5000);

        // Top invoices by value
        const topInvoices = [...currentInvoices]
            .sort((a, b) => (b.total || 0) - (a.total || 0))
            .slice(0, 10)
            .map(inv => {
                const paid = getPaidAmount(inv);
                const customer = inv.customer as any;
                return {
                    invoiceId: String(inv._id),
                    customerName: customer?.name || 'Unknown',
                    total: inv.total || 0,
                    discount: inv.discount || 0,
                    paid,
                    balance: Math.max((inv.total || 0) - paid, 0),
                    billDate: new Date(String(inv.billDate)).toISOString(),
                    isCleared: !!inv.billClearDate,
                };
            });

        // Daily revenue breakdown
        const dailyMap = new Map<string, { revenue: number; invoices: number; discounts: number }>();
        for (const inv of currentInvoices) {
            const key = startOfDay(new Date(String(inv.billDate))).toISOString();
            const entry = dailyMap.get(key) || { revenue: 0, invoices: 0, discounts: 0 };
            dailyMap.set(key, {
                revenue: entry.revenue + (inv.total || 0),
                invoices: entry.invoices + 1,
                discounts: entry.discounts + (inv.discount || 0),
            });
        }

        const dailyRevenue = Array.from(dailyMap.entries())
            .map(([date, data]) => ({ date, ...data }))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        res.json({
            period: {
                from: windowStart.toISOString(),
                to: referenceDate.toISOString(),
                days: windowDays,
                compareFrom: prevWindowStart.toISOString(),
                compareTo: prevWindowEnd.toISOString(),
            },
            revenue: {
                gross: round(grossRevenue),
                net: round(grossRevenue),
                delta: round(revenueDelta),
                collected: round(totalCollected),
                outstanding: round(outstandingReceivables),
                collectionEfficiency: round(collectionEfficiency),
            },
            invoiceQuality: {
                count: invoiceCount,
                avgValue: round(avgInvoiceValue),
                clearedCount,
                creditSalesRatio: round(creditSalesRatio),
                highValueCount: highValueInvoices.length,
                highValueRevenue: round(highValueInvoices.reduce((s, inv) => s + (inv.total || 0), 0)),
            },
            discountAnalysis: {
                totalDiscount: round(totalDiscount),
                discountRatio: round(discountRatio),
                excessiveDiscountCount: excessiveDiscountInvoices.length,
                avgDiscountPerInvoice: invoiceCount > 0 ? round(totalDiscount / invoiceCount) : 0,
            },
            paymentMethods: {
                cash: round(cashCollected),
                online: round(onlineCollected),
                cashShare: totalCollected > 0 ? round((cashCollected / totalCollected) * 100) : 0,
                onlineShare: totalCollected > 0 ? round((onlineCollected / totalCollected) * 100) : 0,
            },
            topInvoices,
            dailyRevenue,
        });
    } catch (error) {
        next(error);
    }
};
