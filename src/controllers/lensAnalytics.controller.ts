import { Request, Response, NextFunction } from 'express';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { OpticalLens } from '../models/OpticalLens.model';

export const getLensAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 90, 730);
    const from = new Date();
    from.setDate(from.getDate() - days);

    // Items that carry lens data (catalogue or custom)
    const baseMatch: Record<string, any> = {
      createdAt: { $gte: from },
      $or: [
        { opticalLens: { $exists: true, $ne: null } },
        { lensBrand: { $exists: true, $ne: null } },
        { lensName:  { $exists: true, $ne: null } },
      ],
    };

    // ── Summary ──────────────────────────────────────────────────────────────
    const [summaryRow] = await InvoiceItem.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalItems:   { $sum: '$quantity' },
          totalRevenue: { $sum: { $multiply: ['$price', '$quantity'] } },
          customCount:  { $sum: { $cond: [{ $eq: ['$isCustomLens', true] }, '$quantity', 0] } },
        },
      },
    ]);

    const summary = summaryRow ?? { totalItems: 0, totalRevenue: 0, customCount: 0 };

    // ── Top Selling Products ─────────────────────────────────────────────────
    const topProductsRaw = await InvoiceItem.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            lensId:   '$opticalLens',
            brand:    '$lensBrand',
            name:     '$lensName',
            index:    '$lensIndex',
            category: '$lensCategory',
            coating:  '$lensCoating',
          },
          unitsSold: { $sum: '$quantity' },
          revenue:   { $sum: { $multiply: ['$price', '$quantity'] } },
        },
      },
      { $sort: { unitsSold: -1 } },
      { $limit: 15 },
    ]);

    // ── Index Demand ─────────────────────────────────────────────────────────
    const indexRaw = await InvoiceItem.aggregate([
      {
        $match: {
          ...baseMatch,
          lensIndex: { $exists: true, $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id:   '$lensIndex',
          count: { $sum: '$quantity' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totalIndexed = indexRaw.reduce((s, r) => s + r.count, 0);
    const indexDemand = indexRaw.map(r => ({
      index:   r._id,
      count:   r.count,
      percent: totalIndexed > 0 ? Math.round((r.count / totalIndexed) * 100) : 0,
    }));

    // ── Category Breakdown ────────────────────────────────────────────────────
    const categoryRaw = await InvoiceItem.aggregate([
      {
        $match: {
          ...baseMatch,
          lensCategory: { $exists: true, $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id:     '$lensCategory',
          count:   { $sum: '$quantity' },
          revenue: { $sum: { $multiply: ['$price', '$quantity'] } },
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalCat = categoryRaw.reduce((s, r) => s + r.count, 0);
    const categoryBreakdown = categoryRaw.map(r => ({
      category: r._id,
      count:    r.count,
      revenue:  r.revenue,
      percent:  totalCat > 0 ? Math.round((r.count / totalCat) * 100) : 0,
    }));

    // ── Brand Breakdown ───────────────────────────────────────────────────────
    const brandRaw = await InvoiceItem.aggregate([
      {
        $match: {
          ...baseMatch,
          lensBrand: { $exists: true, $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id:     '$lensBrand',
          count:   { $sum: '$quantity' },
          revenue: { $sum: { $multiply: ['$price', '$quantity'] } },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    const totalBrand = brandRaw.reduce((s, r) => s + r.count, 0);
    const brandBreakdown = brandRaw.map(r => ({
      brand:   r._id,
      count:   r.count,
      revenue: r.revenue,
      percent: totalBrand > 0 ? Math.round((r.count / totalBrand) * 100) : 0,
    }));

    // ── Restock Recommendations (catalogue lenses with velocity) ─────────────
    const catalogueSales = await InvoiceItem.aggregate([
      {
        $match: {
          ...baseMatch,
          opticalLens: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id:      '$opticalLens',
          unitsSold: { $sum: '$quantity' },
          revenue:   { $sum: { $multiply: ['$price', '$quantity'] } },
          brand:    { $first: '$lensBrand' },
          name:     { $first: '$lensName' },
          index:    { $first: '$lensIndex' },
          category: { $first: '$lensCategory' },
          coating:  { $first: '$lensCoating' },
        },
      },
      { $sort: { unitsSold: -1 } },
      { $limit: 12 },
    ]);

    const lensIds = catalogueSales.map(r => r._id).filter(Boolean);
    const lensMap = new Map(
      (await OpticalLens.find({ _id: { $in: lensIds } }).select('_id sellPrice'))
        .map(l => [l._id.toString(), l])
    );

    const perMonth = days / 30;
    const stockRecommendations = catalogueSales.map(row => {
      const lens = lensMap.get(row._id?.toString() ?? '');
      const unitsPerMonth = row.unitsSold / perMonth;
      return {
        lensId:        row._id,
        brand:         row.brand   ?? '—',
        name:          row.name    ?? '—',
        index:         row.index   ?? '—',
        category:      row.category ?? '—',
        coating:       row.coating  ?? null,
        unitsSold:     row.unitsSold,
        revenue:       row.revenue,
        unitsPerMonth: parseFloat(unitsPerMonth.toFixed(1)),
        sellPrice:     lens?.sellPrice ?? null,
        velocity:      unitsPerMonth >= 3 ? 'high' : unitsPerMonth >= 1 ? 'medium' : 'low',
      };
    });

    // ── Monthly Trend (last 6 months) ────────────────────────────────────────
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyRaw = await InvoiceItem.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo },
          $or: baseMatch.$or,
        },
      },
      {
        $group: {
          _id: {
            year:  { $year:  '$createdAt' },
            month: { $month: '$createdAt' },
          },
          unitsSold: { $sum: '$quantity' },
          revenue:   { $sum: { $multiply: ['$price', '$quantity'] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const monthlyTrend = monthlyRaw.map(r => ({
      month:     `${r._id.year}-${String(r._id.month).padStart(2, '0')}`,
      unitsSold: r.unitsSold,
      revenue:   r.revenue,
    }));

    res.json({
      window: { days, from },
      summary: {
        totalItems:    summary.totalItems,
        totalRevenue:  summary.totalRevenue,
        customCount:   summary.customCount,
        customPercent: summary.totalItems > 0
          ? Math.round((summary.customCount / summary.totalItems) * 100) : 0,
      },
      topProducts: topProductsRaw.map(r => ({
        lensId:    r._id.lensId ?? null,
        brand:     r._id.brand    ?? '—',
        name:      r._id.name     ?? '—',
        index:     r._id.index    ?? '—',
        category:  r._id.category ?? '—',
        coating:   r._id.coating  ?? null,
        unitsSold: r.unitsSold,
        revenue:   r.revenue,
      })),
      indexDemand,
      categoryBreakdown,
      brandBreakdown,
      stockRecommendations,
      monthlyTrend,
    });
  } catch (error) {
    next(error);
  }
};
