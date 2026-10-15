import { Request, Response, NextFunction } from 'express';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { Expense } from '../models/Expense.model';
import { MonthlyTarget } from '../models/MonthlyTarget.model';
import { Frame } from '../models/Frame.model';
import { LensStock } from '../models/LensStock.model';
import { wholesaleEntries } from '../services/wholesaleCatalog';
import { Fragrance } from '../models/Fragrance.model';
import { catchAllIds, isCatchAllFrame } from '../services/catchAllProducts';
import {
  cashSeries, collections, dailySeries, expenseFigures, resolvePeriod, salesFigures, savedFragranceCost, targetProgress,
} from '../services/analyticsOverview';

const DAY = 86_400_000;
const LAB_TURNAROUND_DAYS = 1;
const INVOICE_FIELDS = { billDate: 1, subtotal: 1, discount: 1, total: 1, payments: 1, items: 1, isNewCustomer: 1, visitNumber: 1, acquisitionSource: 1, packagingCost: 1, paymentProcessingFee: 1 };

/** Bills with a payment dated in the window (payments can come long after the bill). */
const paidIn = (from: Date, to: Date) =>
  Invoice.find({
    $or: [
      { 'payments.date': { $gte: from.toISOString(), $lte: to.toISOString() } },
      { 'payments.date': { $gte: from, $lte: to } },
      { billDate: { $gte: from, $lte: to } },
    ],
  }).select({ payments: 1, billDate: 1 }).lean();

const change = (now: number | null, before: number | null) =>
  now === null || before === null || before === 0 ? null : Number((((now - before) / Math.abs(before)) * 100).toFixed(1));

/**
 * GET /analytics/overview?period=mtd|last_month|30d|90d — the main analytics page: KPIs with the
 * comparison period, target progress, what needs attention, daily sales, category mix, cash in/out
 * (stock purchases apart from running costs) and customers.
 */
export const getAnalyticsOverview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const period = resolvePeriod(req.query.period as string | undefined, now);

    const [cur, prev, curPaid, prevPaid, expenses, prevExpenses, targetDoc, dues, openLab, frames, lensStock, wholesale, fragrances] = await Promise.all([
      Invoice.find({ billDate: { $gte: period.from, $lte: period.to } }).select(INVOICE_FIELDS).populate('items').lean(),
      Invoice.find({ billDate: { $gte: period.compareFrom, $lte: period.compareTo } }).select(INVOICE_FIELDS).populate('items').lean(),
      paidIn(period.from, period.to),
      paidIn(period.compareFrom, period.compareTo),
      Expense.find({ date: { $gte: period.from, $lte: period.to }, isVoid: { $ne: true } }).select('amount category date paymentMethod').lean(),
      Expense.find({ date: { $gte: period.compareFrom, $lte: period.compareTo }, isVoid: { $ne: true } }).select('amount category date paymentMethod').lean(),
      period.targetMonth ? MonthlyTarget.findOne({ month: period.targetMonth }).lean() : Promise.resolve(null),
      Invoice.find({ hasDue: true }).select({ total: 1, payments: 1, billDate: 1 }).lean(),
      InvoiceItem.find({ isLabItem: true, isOpenLabJob: true }).select('createdAt labStatus sentToWholesaler').lean(),
      Frame.find({}).select('name stock createdAt isArchived').lean(),
      LensStock.find({}).select('quantity reorderLevel').lean(),
      Promise.resolve(null),
      Fragrance.find({}).lean(),
    ]);

    const costOf = savedFragranceCost(fragrances as any);
    const catchAll = catchAllIds(frames as any, fragrances as any);
    const sales = salesFigures(cur as any, costOf, catchAll);
    const prevSales = salesFigures(prev as any, costOf, catchAll);
    const col = collections(curPaid as any, period.from, period.to);
    const prevCol = collections(prevPaid as any, period.compareFrom, period.compareTo);
    const exp = expenseFigures(expenses as any, period.from, period.to);
    const prevExp = expenseFigures(prevExpenses as any, period.compareFrom, period.compareTo);

    // Outstanding balances on all bills, with how old they are.
    let duesTotal = 0;
    let duesOld = 0;
    for (const inv of dues as any[]) {
      const paid = (inv.payments ?? []).reduce((s: number, p: any) => s + (p.amount || 0) + (p.writeoff || 0), 0);
      const bal = Math.max(0, (inv.total || 0) - paid);
      duesTotal += bal;
      if (bal > 0 && now.getTime() - new Date(inv.billDate).getTime() > 30 * DAY) duesOld += bal;
    }

    // Lab jobs are expected back within 1 day.
    const labOverdue = (openLab as any[]).filter((i) => i.createdAt && now.getTime() - new Date(i.createdAt).getTime() > LAB_TURNAROUND_DAYS * DAY).length;
    // Out of stock, not merely "at re-order level": most powers hold 1 pair against a level of 2, which made nearly all look low.
    const lowPowers = (lensStock as any[]).filter((s) => (s.quantity ?? 0) <= 0).length;
    const agedFrames = (frames as any[]).filter((f) => !f.isArchived && !isCatchAllFrame(f) && (f.stock ?? 0) > 0 && f.createdAt && now.getTime() - new Date(f.createdAt).getTime() > 180 * DAY).length;
    void wholesale;
    const wsLow = wholesaleEntries((fragrances as any[]).filter((f) => !f.isArchived))
      .filter((w) => !w.isOrdered && (w.stock <= 0 || (w.reorderLevel != null && w.stock <= w.reorderLevel))).length;

    let recallsDue: number | null = null;
    try {
      const { getCustomerRecalls } = await import('../services/recallEngine');
      recallsDue = (await getCustomerRecalls(now)).counts.annualEyeTestCount;
    } catch {
      recallsDue = null; // recalls are a nice-to-have; the page still loads without them
    }

    const attention = [
      { key: 'dues', label: 'Dues pending', count: (dues as any[]).length, amount: Math.round(duesTotal), detail: duesOld > 0 ? `₹${Math.round(duesOld).toLocaleString('en-IN')} older than 30 days` : undefined, href: '/invoices?tab=dues' },
      { key: 'lab', label: 'Lab orders open', count: (openLab as any[]).length, detail: labOverdue ? `${labOverdue} past 1 day` : undefined, href: '/wholesale' },
      { key: 'powers', label: 'Lens powers out of stock', count: lowPowers, href: '/lens-stock' },
      { key: 'frames', label: 'Frames over 6 months', count: agedFrames, href: '/analytics/optics' },
      { key: 'wholesale', label: 'Wholesale low, not ordered', count: wsLow, href: '/bulk-stock/order' },
      ...(recallsDue !== null ? [{ key: 'recalls', label: 'Eye-test recalls due', count: recallsDue, href: '/' }] : []),
    ];

    const target = targetProgress((targetDoc as any)?.revenueTarget, sales.revenue, period);
    const cashIn = col.cash;

    res.json({
      period: {
        key: period.key, label: period.label, compareLabel: period.compareLabel,
        from: period.from.toISOString(), to: period.to.toISOString(),
        compareFrom: period.compareFrom.toISOString(), compareTo: period.compareTo.toISOString(),
      },
      kpis: {
        revenue: { value: sales.revenue, previous: prevSales.revenue, changePct: change(sales.revenue, prevSales.revenue), invoices: sales.invoices, aov: sales.aov },
        grossProfit: {
          value: sales.grossProfit, previous: prevSales.grossProfit, changePct: change(sales.grossProfit, prevSales.grossProfit),
          marginPct: sales.marginPct, coveragePct: sales.coveragePct, uncostedLines: sales.uncostedLines, mixedSales: sales.mixedSales,
          netContribution: sales.netContribution, packaging: sales.packaging, fees: sales.fees,
        },
        collected: { value: col.total, previous: prevCol.total, changePct: change(col.total, prevCol.total), cash: col.cash, upi: col.upi },
        dues: { value: Math.round(duesTotal), count: (dues as any[]).length, olderThan30: Math.round(duesOld) },
        cash: { in: cashIn, out: exp.cashOut, net: cashIn - exp.cashOut },
        discount: { value: sales.discount, previous: prevSales.discount, pctOfBilled: sales.billed > 0 ? Number(((sales.discount / sales.billed) * 100).toFixed(1)) : 0 },
      },
      target,
      attention,
      daily: dailySeries(cur as any, prev as any, period),
      categories: { billed: sales.billed, discount: sales.discount, revenue: sales.revenue, items: sales.categories },
      cash: {
        collected: col.total, cash: col.cash, upi: col.upi,
        stockPurchases: exp.stockPurchases, operating: exp.operating, home: exp.home,
        previous: { collected: prevCol.total, stockPurchases: prevExp.stockPurchases, operating: prevExp.operating },
        operatingByCategory: exp.operatingByCategory,
        daily: cashSeries(col, exp, period),
      },
      customers: { ...sales.customers, previous: prevSales.customers },
    });
  } catch (e) {
    next(e);
  }
};
