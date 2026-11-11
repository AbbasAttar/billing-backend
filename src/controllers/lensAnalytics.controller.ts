import { Request, Response, NextFunction } from 'express';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { OpticalLens } from '../models/OpticalLens.model';
import {
  type LensLine, bucketKey, bucketRange, eyeSales, isLensLine, linePairs, lineQty, lineRevenue,
  normalizeLensLine, share, signed, trendGranularity, windowFrom,
} from '../services/lensSales';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);

type Tally = { pairs: number; revenue: number };
const bump = <K>(map: Map<K, Tally>, key: K, pairs: number, revenue: number) => {
  const t = map.get(key) ?? { pairs: 0, revenue: 0 };
  t.pairs += pairs;
  t.revenue += revenue;
  map.set(key, t);
};

/**
 * GET /optical-lenses/analytics?days=N — lens sales for the window (Analytics → Lens → Rx demand).
 * Counting rules live in services/lensSales: pairs for products, pieces per eye for powers,
 * revenue once per line. Every percentage is a share of the whole window, not of the rows shown.
 */
export const getLensAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days, from } = windowFrom(req.query.days);
    const all = (await InvoiceItem.find({ createdAt: { $gte: from } }).lean()) as LensLine[];
    const lines = all.filter(isLensLine).map(normalizeLensLine);

    // ── Summary ──────────────────────────────────────────────────────────────
    let totalPairs = 0, totalPieces = 0, totalRevenue = 0, customPairs = 0;
    let costedRevenue = 0, cost = 0;
    for (const it of lines) {
      const pairs = linePairs(it);
      const rev = lineRevenue(it);
      totalPairs += pairs;
      totalPieces += pairs * 2;
      totalRevenue += rev;
      if (it.isCustomLens) customPairs += pairs;
      if (typeof it.costPrice === 'number' && it.costPrice > 0) {
        cost += lineQty(it) * it.costPrice;
        costedRevenue += rev;
      }
    }
    const grossProfit = costedRevenue - cost;

    // ── Products, index, category, brand ─────────────────────────────────────
    const products = new Map<string, Tally & { lensId: unknown; brand: string; name: string; index: string; category: string; coating: string | null }>();
    const byIndex = new Map<string, Tally>();
    const byCategory = new Map<string, Tally>();
    const byBrand = new Map<string, Tally>();
    const catalogue = new Map<string, Tally & { brand: string; name: string; index: string; category: string; coating: string | null }>();

    for (const it of lines) {
      const pairs = linePairs(it);
      const rev = lineRevenue(it);
      // Counter / lab lines often have no product name: describe them by lens kind instead.
      const kindName = [it.lensType, it.lensMaterial, it.lensColor && it.lensColor !== 'White' ? it.lensColor : null].filter(Boolean).join(' · ');
      const desc = {
        brand: it.lensBrand || '—', name: it.lensName || kindName || '—', index: it.lensIndex || '—',
        category: it.lensCategory || it.lensType || '—', coating: it.lensCoating || null,
      };
      const lensId = it.opticalLens ? String((it.opticalLens as { _id?: unknown })?._id ?? it.opticalLens) : null;
      const pKey = [lensId, desc.brand, desc.name, desc.index, desc.category, desc.coating].join('|');
      const p = products.get(pKey) ?? { ...desc, lensId, pairs: 0, revenue: 0 };
      p.pairs += pairs; p.revenue += rev;
      products.set(pKey, p);

      if (it.lensIndex) bump(byIndex, it.lensIndex, pairs, rev);
      if (desc.category !== '—') bump(byCategory, desc.category, pairs, rev);
      if (it.lensBrand) bump(byBrand, it.lensBrand, pairs, rev);
      if (lensId) {
        const c = catalogue.get(lensId) ?? { ...desc, pairs: 0, revenue: 0 };
        c.pairs += pairs; c.revenue += rev;
        catalogue.set(lensId, c);
      }
    }

    const sum = (m: Map<string, Tally>) => [...m.values()].reduce((s, t) => s + t.pairs, 0);
    const indexTotal = sum(byIndex), catTotal = sum(byCategory), brandTotal = sum(byBrand);

    const topProducts = [...products.values()]
      .sort((a, b) => b.pairs - a.pairs)
      .slice(0, 15)
      .map((p) => ({ lensId: p.lensId, brand: p.brand, name: p.name, index: p.index, category: p.category, coating: p.coating, unitsSold: r1(p.pairs), revenue: r0(p.revenue) }));

    // Index stays in index order (the chart reads as a spectrum); the UI picks the top seller itself.
    const indexDemand = [...byIndex.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([index, t]) => ({ index, count: r1(t.pairs), percent: share(t.pairs, indexTotal) }));

    const categoryBreakdown = [...byCategory.entries()]
      .sort(([, a], [, b]) => b.pairs - a.pairs)
      .map(([category, t]) => ({ category, count: r1(t.pairs), revenue: r0(t.revenue), percent: share(t.pairs, catTotal) }));

    const brandsSorted = [...byBrand.entries()].sort(([, a], [, b]) => b.pairs - a.pairs);
    const brandBreakdown = brandsSorted
      .slice(0, 8)
      .map(([brand, t]) => ({ brand, count: r1(t.pairs), revenue: r0(t.revenue), percent: share(t.pairs, brandTotal) }));
    const otherBrands = brandsSorted.slice(8).reduce((s, [, t]) => s + t.pairs, 0);

    // ── Restock radar (catalogue lenses by speed) ────────────────────────────
    const topCatalogue = [...catalogue.entries()].sort(([, a], [, b]) => b.pairs - a.pairs).slice(0, 12);
    const lensMap = new Map(
      (topCatalogue.length ? await OpticalLens.find({ _id: { $in: topCatalogue.map(([id]) => id) } }).select('_id sellPrice').lean() : [])
        .map((l: any) => [String(l._id), l]),
    );
    const months = days / 30;
    const stockRecommendations = topCatalogue.map(([id, c]) => {
      const unitsPerMonth = c.pairs / months;
      return {
        lensId: id, brand: c.brand, name: c.name, index: c.index, category: c.category, coating: c.coating,
        unitsSold: r1(c.pairs), revenue: r0(c.revenue),
        unitsPerMonth: r1(unitsPerMonth),
        sellPrice: (lensMap.get(id) as any)?.sellPrice ?? null,
        velocity: unitsPerMonth >= 3 ? 'high' : unitsPerMonth >= 1 ? 'medium' : 'low',
      };
    });

    // ── Prescription demand (pieces per eye, minus cyl) ──────────────────────
    const sph = new Map<number, number>(), cyl = new Map<number, number>(), add = new Map<number, number>();
    const inc = (m: Map<number, number>, k: number, n: number) => m.set(k, (m.get(k) ?? 0) + n);
    for (const it of lines) {
      for (const e of eyeSales(it)) {
        inc(sph, e.sph, e.pieces);
        inc(cyl, e.cyl, e.pieces);
        if (e.add !== null) inc(add, e.add, e.pieces);
      }
    }
    const sumOf = (m: Map<number, number>) => [...m.values()].reduce((s, n) => s + n, 0);
    const rxDemand = (m: Map<number, number>, limit: number) => {
      const total = [...m.values()].reduce((s, n) => s + n, 0);
      return [...m.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([value, count]) => ({ value, label: signed(value), count, percent: share(count, total) }));
    };

    // ── Trend over the same window ───────────────────────────────────────────
    const granularity = trendGranularity(days);
    const buckets = new Map(bucketRange(from, new Date(), granularity).map((k) => [k, { pairs: 0, revenue: 0 }]));
    for (const it of lines) {
      if (!it.createdAt) continue;
      const b = buckets.get(bucketKey(it.createdAt, granularity));
      if (b) { b.pairs += linePairs(it); b.revenue += lineRevenue(it); }
    }

    res.json({
      window: { days, from },
      summary: {
        totalPairs: r1(totalPairs),
        totalPieces: r0(totalPieces),
        totalRevenue: r0(totalRevenue),
        customPairs: r1(customPairs),
        customPercent: share(customPairs, totalPairs),
        grossProfit: r0(grossProfit),
        marginPercent: costedRevenue > 0 ? share(grossProfit, costedRevenue) : null,
        costCoveragePercent: share(costedRevenue, totalRevenue),
      },
      topProducts,
      indexDemand,
      categoryBreakdown,
      brandBreakdown,
      otherBrandsPairs: r1(otherBrands),
      otherBrandsPercent: share(otherBrands, brandTotal),
      stockRecommendations,
      trend: {
        granularity,
        points: [...buckets.entries()].map(([key, t]) => ({ key, pairs: r1(t.pairs), revenue: r0(t.revenue) })),
      },
      sphericalDemand: rxDemand(sph, 20),
      cylinderDemand: rxDemand(cyl, 15),
      additionDemand: rxDemand(add, 10),
      // Lenses behind each list (the % denominators), so the page can say how much the top rows cover.
      rxTotals: { sph: sumOf(sph), cyl: sumOf(cyl), add: sumOf(add) },
    });
  } catch (error) {
    next(error);
  }
};
