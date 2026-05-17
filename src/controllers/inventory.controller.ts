import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Frame } from '../models/Frame.model';
import { Fragrance } from '../models/Fragrance.model';
import { OpticalLens } from '../models/OpticalLens.model';
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

const round = (v: number, d = 2) => Number(v.toFixed(d));
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

type RiskLevel = 'fast' | 'steady' | 'slow' | 'dead' | 'new';

const classifyVelocity = (unitsPer30Days: number): RiskLevel => {
    if (unitsPer30Days >= 3) return 'fast';
    if (unitsPer30Days >= 0.5) return 'steady';
    if (unitsPer30Days > 0) return 'slow';
    return 'dead';
};

const computeMargin = (costPrice?: number | null, sellPrice?: number | null) => {
    if (!costPrice || !sellPrice || sellPrice === 0) return null;
    return round(((sellPrice - costPrice) / sellPrice) * 100);
};

const computeInventoryValue = (costPrice?: number | null, stock?: number | null) => {
    if (costPrice == null || stock == null) return 0;
    return costPrice * stock;
};

// Aggregate per-product sales stats from InvoiceItems joined via Invoice dates
const buildSalesMap = async (
    productField: 'frame' | 'opticalLens' | 'fragrance',
    windowStart: Date,
    windowEnd: Date
): Promise<Map<string, { units: number; revenue: number; lastSoldAt: Date | null }>> => {
    const pipeline: any[] = [
        { $match: { billDate: { $gte: windowStart, $lte: windowEnd } } },
        {
            $lookup: {
                from: 'invoiceitems',
                localField: 'items',
                foreignField: '_id',
                as: 'itemDocs',
            },
        },
        { $unwind: '$itemDocs' },
        { $match: { [`itemDocs.${productField}`]: { $exists: true, $ne: null } } },
        {
            $group: {
                _id: `$itemDocs.${productField}`,
                units: { $sum: '$itemDocs.quantity' },
                revenue: { $sum: { $multiply: ['$itemDocs.quantity', '$itemDocs.price'] } },
                lastSoldAt: { $max: '$billDate' },
            },
        },
    ];

    const results = await Invoice.aggregate(pipeline);
    const map = new Map<string, { units: number; revenue: number; lastSoldAt: Date | null }>();
    for (const r of results) {
        map.set(r._id.toString(), {
            units: r.units ?? 0,
            revenue: r.revenue ?? 0,
            lastSoldAt: r.lastSoldAt ?? null,
        });
    }
    return map;
};

// GET /api/inventory/intelligence
export const getInventoryIntelligence = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const now = new Date();
        const windowDays = 90;
        const windowStart = startOfDay(addDays(now, -(windowDays - 1)));
        const q = ((req.query.q as string) || '').trim().toLowerCase();
        const categoryFilter = (req.query.category as string) || 'all';

        // Fetch all products + sales maps in parallel
        const [allFrames, allFragrances, allLenses, frameSales, fragranceSales, lensSales] = await Promise.all([
            Frame.find().lean(),
            Fragrance.find().lean(),
            OpticalLens.find().lean(),
            buildSalesMap('frame', windowStart, now),
            buildSalesMap('fragrance', windowStart, now),
            buildSalesMap('opticalLens', windowStart, now),
        ]);

        type ProductEntry = {
            productId: string;
            name: string;
            displayName: string;
            category: 'frame' | 'opticalLens' | 'fragrance';
            categoryLabel: string;
            brand: string;
            subType?: string;
            costPrice: number | null;
            sellPrice: number | null;
            margin: number | null;
            stock: number | null;
            stockValue: number;
            unitsSold90d: number;
            revenue90d: number;
            unitsPer30Days: number;
            lastSoldAt: string | null;
            daysSinceLastSale: number | null;
            velocityLabel: RiskLevel;
            inventorySignal: 'tracked' | 'catalog_only';
        };

        const enrichProduct = (
            product: any,
            category: 'frame' | 'opticalLens' | 'fragrance',
            salesMap: Map<string, { units: number; revenue: number; lastSoldAt: Date | null }>
        ): ProductEntry => {
            const id = (product._id as mongoose.Types.ObjectId).toString();
            const sales = salesMap.get(id);
            const units = sales?.units ?? 0;
            const revenue = sales?.revenue ?? 0;
            const lastSoldAt = sales?.lastSoldAt ?? null;
            const daysSince = lastSoldAt
                ? Math.floor((now.getTime() - new Date(lastSoldAt).getTime()) / 86400000)
                : null;

            const unitsPer30Days = (units / windowDays) * 30;
            const velocity = classifyVelocity(unitsPer30Days);

            const stock = typeof product.stock === 'number' ? product.stock : null;
            const cost = product.costPrice ?? null;
            const sell = product.sellPrice ?? null;

            const brandName =
                category === 'opticalLens' ? product.brand :
                product.companyName || '';

            const displayName = brandName ? `${product.name} · ${brandName}` : product.name;

            return {
                productId: id,
                name: product.name,
                displayName,
                category,
                categoryLabel: category === 'frame' ? 'Frames' : category === 'opticalLens' ? 'Lenses' : 'Fragrance',
                brand: brandName,
                subType: product.type || product.category || undefined,
                costPrice: cost,
                sellPrice: sell,
                margin: computeMargin(cost, sell),
                stock,
                stockValue: computeInventoryValue(cost, stock),
                unitsSold90d: units,
                revenue90d: round(revenue),
                unitsPer30Days: round(unitsPer30Days),
                lastSoldAt: lastSoldAt ? new Date(lastSoldAt).toISOString() : null,
                daysSinceLastSale: daysSince,
                velocityLabel: velocity,
                inventorySignal: stock !== null ? 'tracked' : 'catalog_only',
            };
        };

        let allProducts: ProductEntry[] = [
            ...allFrames.map(p => enrichProduct(p, 'frame', frameSales)),
            ...allFragrances.map(p => enrichProduct(p, 'fragrance', fragranceSales)),
            ...allLenses.map(p => enrichProduct(p, 'opticalLens', lensSales)),
        ];

        // Apply category filter
        if (categoryFilter !== 'all') {
            allProducts = allProducts.filter(p => p.category === categoryFilter);
        }

        // Apply search filter
        if (q) {
            allProducts = allProducts.filter(p =>
                p.name.toLowerCase().includes(q) ||
                p.brand.toLowerCase().includes(q) ||
                (p.subType || '').toLowerCase().includes(q)
            );
        }

        // Sort: fast movers first, then by revenue
        allProducts.sort((a, b) => {
            const velocityOrder = { fast: 0, steady: 1, slow: 2, new: 3, dead: 4 };
            const vDiff = velocityOrder[a.velocityLabel] - velocityOrder[b.velocityLabel];
            if (vDiff !== 0) return vDiff;
            return b.revenue90d - a.revenue90d;
        });

        // Summary stats
        const deadStock = allProducts.filter(p => p.velocityLabel === 'dead' && (p.daysSinceLastSale === null || p.daysSinceLastSale > 60));
        const fastMovers = allProducts.filter(p => p.velocityLabel === 'fast');
        const slowMovers = allProducts.filter(p => p.velocityLabel === 'slow');
        const trackedProducts = allProducts.filter(p => p.inventorySignal === 'tracked');
        const totalStockValue = allProducts.reduce((s, p) => s + p.stockValue, 0);
        const avgMargin = (() => {
            const withMargin = allProducts.filter(p => p.margin !== null);
            if (!withMargin.length) return 0;
            return round(withMargin.reduce((s, p) => s + (p.margin ?? 0), 0) / withMargin.length);
        })();

        const summary = {
            totalProducts: allProducts.length,
            framesCount: allFrames.length,
            fragrancesCount: allFragrances.length,
            lensesCount: allLenses.length,
            deadStockCount: deadStock.length,
            fastMoversCount: fastMovers.length,
            slowMoversCount: slowMovers.length,
            trackedStockCount: trackedProducts.length,
            totalStockValue: round(totalStockValue),
            avgMargin,
            windowDays,
        };

        // Category breakdown
        const categoryBreakdown = [
            {
                category: 'frame',
                label: 'Frames',
                count: allFrames.length,
                activeSellers: allProducts.filter(p => p.category === 'frame' && p.unitsSold90d > 0).length,
                deadCount: allProducts.filter(p => p.category === 'frame' && p.velocityLabel === 'dead').length,
                revenue90d: round(allProducts.filter(p => p.category === 'frame').reduce((s, p) => s + p.revenue90d, 0)),
                avgMargin: (() => {
                    const items = allProducts.filter(p => p.category === 'frame' && p.margin !== null);
                    return items.length ? round(items.reduce((s, p) => s + (p.margin ?? 0), 0) / items.length) : 0;
                })(),
            },
            {
                category: 'fragrance',
                label: 'Fragrance',
                count: allFragrances.length,
                activeSellers: allProducts.filter(p => p.category === 'fragrance' && p.unitsSold90d > 0).length,
                deadCount: allProducts.filter(p => p.category === 'fragrance' && p.velocityLabel === 'dead').length,
                revenue90d: round(allProducts.filter(p => p.category === 'fragrance').reduce((s, p) => s + p.revenue90d, 0)),
                avgMargin: (() => {
                    const items = allProducts.filter(p => p.category === 'fragrance' && p.margin !== null);
                    return items.length ? round(items.reduce((s, p) => s + (p.margin ?? 0), 0) / items.length) : 0;
                })(),
            },
            {
                category: 'opticalLens',
                label: 'Lenses',
                count: allLenses.length,
                activeSellers: allProducts.filter(p => p.category === 'opticalLens' && p.unitsSold90d > 0).length,
                deadCount: allProducts.filter(p => p.category === 'opticalLens' && p.velocityLabel === 'dead').length,
                revenue90d: round(allProducts.filter(p => p.category === 'opticalLens').reduce((s, p) => s + p.revenue90d, 0)),
                avgMargin: (() => {
                    const items = allProducts.filter(p => p.category === 'opticalLens' && p.margin !== null);
                    return items.length ? round(items.reduce((s, p) => s + (p.margin ?? 0), 0) / items.length) : 0;
                })(),
            },
        ];

        res.json({
            summary,
            categoryBreakdown,
            // Top 15 fast movers
            fastMovers: fastMovers.slice(0, 15),
            // Dead/risk products (limit 30 for response size)
            deadStock: deadStock.slice(0, 30),
            // Full catalog (for search, limited to 200)
            products: allProducts.slice(0, 200),
            totalMatched: allProducts.length,
        });
    } catch (error) {
        next(error);
    }
};
