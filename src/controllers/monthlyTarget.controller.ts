import { NextFunction, Request, Response } from 'express';
import { MonthlyTarget } from '../models/MonthlyTarget.model';
import { Invoice } from '../models/Invoice.model';
import { fail, ok } from '../utils/response';

const isValidMonth = (value: string): boolean => /^\d{4}-\d{2}$/.test(value);

export const upsertMonthlyTarget = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { month } = req.params;
    if (!isValidMonth(String(month))) return fail(res, 'month must be in YYYY-MM format', 400);

    const { revenueTarget, expenseBudget, personalBudget, notes } = req.body as {
      revenueTarget?: number;
      expenseBudget?: number;
      personalBudget?: number;
      notes?: string;
    };

    if (typeof revenueTarget !== 'number' || revenueTarget < 0)
      return fail(res, 'revenueTarget must be a non-negative number', 400);
    if (typeof expenseBudget !== 'number' || expenseBudget < 0)
      return fail(res, 'expenseBudget must be a non-negative number', 400);
    if (typeof personalBudget !== 'number' || personalBudget < 0)
      return fail(res, 'personalBudget must be a non-negative number', 400);

    const target = await MonthlyTarget.findOneAndUpdate(
      { month },
      { revenueTarget, expenseBudget, personalBudget, notes },
      { upsert: true, new: true, runValidators: true }
    );
    return ok(res, target, 'Monthly target saved', 200);
  } catch (error) {
    next(error);
  }
};

export const getMonthlyTargets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targets = await MonthlyTarget.find().sort({ month: -1 }).limit(24);
    return ok(res, targets);
  } catch (error) {
    next(error);
  }
};

export const getCurrentMonthTarget = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const target = await MonthlyTarget.findOne({ month });
    return ok(res, target ?? null);
  } catch (error) {
    next(error);
  }
};

export const getMonthlyTargetByMonth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { month } = req.params;
    if (!isValidMonth(String(month))) return fail(res, 'month must be in YYYY-MM format', 400);
    const target = await MonthlyTarget.findOne({ month });
    if (!target) return fail(res, 'No target found for this month', 404);
    return ok(res, target);
  } catch (error) {
    next(error);
  }
};

export const getSuggestedMonthlyTarget = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { month } = req.params;
    const monthStrVal = String(month);
    if (!isValidMonth(monthStrVal)) return fail(res, 'month must be in YYYY-MM format', 400);

    const [yearStr, monthStr] = monthStrVal.split('-');
    const targetYear = parseInt(yearStr);
    const targetMonthNum = parseInt(monthStr); // 1-12
    const targetMonthDate = new Date(targetYear, targetMonthNum - 1, 1);

    const [existingTarget, historicalMonthsAgg] = await Promise.all([
      MonthlyTarget.findOne({ month }),
      Invoice.aggregate([
        { $match: { billDate: { $lt: targetMonthDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$billDate' } },
            revenue: { $sum: '$total' },
            invoices: { $sum: 1 },
          }
        },
        { $sort: { _id: -1 } },
        { $limit: 18 }
      ])
    ]);

    const validMonths = (historicalMonthsAgg || []).filter((m: any) => (m.revenue || 0) >= 15000);
    let avgHistoricalMonthlyRevenue = 115000;
    let avgHistoricalAov = 1100;

    if (validMonths.length > 0) {
      const sumRev = validMonths.reduce((s: number, m: any) => s + (m.revenue || 0), 0);
      const sumInvs = validMonths.reduce((s: number, m: any) => s + (m.invoices || 0), 0);
      avgHistoricalMonthlyRevenue = Math.round(sumRev / validMonths.length);
      if (sumInvs > 0) {
        avgHistoricalAov = Math.round(sumRev / sumInvs);
      }
    }

    // Previous year same month (e.g. 2025-09 if planning for 2026-09)
    const prevYearSameMonthKey = `${targetYear - 1}-${monthStr}`;
    const prevYearSameMonthDoc = (historicalMonthsAgg || []).find((m: any) => m._id === prevYearSameMonthKey);
    const prevYearSameMonthRevenue = prevYearSameMonthDoc?.revenue ? Math.round(prevYearSameMonthDoc.revenue) : null;

    // 3-Month Normalized Run Rate
    const last3Months = validMonths.slice(0, 3);
    const threeMonthRunRate = last3Months.length > 0
      ? Math.round(last3Months.reduce((sum: number, m: any) => sum + (m.revenue || 0), 0) / last3Months.length)
      : avgHistoricalMonthlyRevenue;

    const SEASONAL_INDICES = [0.88, 0.92, 0.98, 0.85, 0.92, 0.95, 0.94, 1.05, 1.00, 1.25, 1.20, 1.10];
    const seasonalFactor = SEASONAL_INDICES[targetMonthNum - 1] || 1.00;

    // 1. Expected = Baseline * Seasonal Factor (what normal business flow naturally yields)
    const expectedRevenue = Math.round(avgHistoricalMonthlyRevenue * seasonalFactor);
    // 2. Recommended Target = Expected * 1.08 (+8% intentional growth)
    const recommendedTarget = Math.round(expectedRevenue * 1.08);
    // 3. Stretch = Recommended * 1.10 (+10% peak execution)
    const stretchRevenue = Math.round(recommendedTarget * 1.10);

    const targetRevenue = existingTarget?.revenueTarget || recommendedTarget;
    const daysInMonth = new Date(targetYear, targetMonthNum, 0).getDate();

    const targetOrders = Math.max(1, Math.round(targetRevenue / avgHistoricalAov));
    const targetAov = Math.round(targetRevenue / targetOrders);
    const dailySalesRequired = Math.round(targetRevenue / daysInMonth);
    const dailyOrdersRequired = Number((targetOrders / daysInMonth).toFixed(1));
    const targetFootfallOpportunities = Math.round(targetOrders / 0.40);

    return ok(res, {
      month,
      targetMonthName: targetMonthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      isLocked: Boolean(existingTarget),
      lockedTarget: existingTarget || null,
      baseline: {
        baselineRevenue: avgHistoricalMonthlyRevenue,
        prevYearSameMonthRevenue,
        threeMonthRunRate,
        seasonalFactor,
        expectedRevenue,
        recommendedTarget,
        stretchRevenue,
      },
      historicalAov: avgHistoricalAov,
      daysInMonth,
      threeTierTargets: {
        expected: expectedRevenue,
        target: targetRevenue,
        stretch: stretchRevenue,
      },
      targetEquation: {
        targetOrders,
        targetAov,
        dailySalesRequired,
        dailyOrdersRequired,
        targetFootfallOpportunities,
        estimatedConversionRatePct: 40,
      },
      drivers: {
        targetOrders,
        targetAov,
        dailySalesRequired,
        dailyOrdersRequired,
        targetFootfallOpportunities,
        estimatedConversionRatePct: 40,
      },
      categoryTargets: {
        frames: { revenue: Math.round(targetRevenue * 0.42), units: Math.round((targetRevenue * 0.42) / 1600), marginPct: 58 },
        lenses: { revenue: Math.round(targetRevenue * 0.48), units: Math.round((targetRevenue * 0.48) / 1200), marginPct: 62 },
        fragrance: { revenue: Math.round(targetRevenue * 0.10), units: Math.round((targetRevenue * 0.10) / 650), marginPct: 52 },
        grossProfit: { targetGP: Math.round(targetRevenue * 0.58), marginPct: 58 },
      }
    });
  } catch (error) {
    next(error);
  }
};

export const deleteMonthlyTarget = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const target = await MonthlyTarget.findByIdAndDelete(req.params.id);
    if (!target) return fail(res, 'Monthly target not found', 404);
    return ok(res, { _id: target._id }, 'Monthly target deleted');
  } catch (error) {
    next(error);
  }
};
