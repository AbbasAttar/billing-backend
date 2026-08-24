import { Request, Response, NextFunction } from 'express';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { LensStock } from '../models/LensStock.model';

const CONFIDENCE_Z = 1.65; // 95th-percentile service level

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// Sample std-dev (Bessel correction), returns 0 for single-point data
function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - avg) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function skuKey(
  lensType: string,
  material: string,
  coating: string,
  color: string,
  sph: number,
  cyl: number,
  add: number | null,
): string {
  return `${lensType}|${material}|${coating}|${color}|${sph}|${cyl}|${add ?? 'null'}`;
}

interface SkuEntry {
  lensType: string;
  material: string;
  coating: string;
  color: string;
  sph: number;
  cyl: number;
  add: number | null;
  dailyMap: Map<string, number>; // ISO date → demand that day
}

export const getLensReorderReport = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const days = Math.min(Math.max(parseInt(String(req.query.days ?? '90'), 10) || 90, 1), 365);
    const leadTimeDays = Math.min(
      Math.max(parseInt(String(req.query.leadTimeDays ?? '5'), 10) || 5, 1),
      60,
    );

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - days);

    // Fetch all lens InvoiceItems in the window (both fulfilled and unfulfilled)
    const items = await InvoiceItem.find({
      createdAt: { $gte: since },
      lensType: { $exists: true, $ne: null },
      lensMaterial: { $exists: true, $ne: null },
    })
      .select(
        'lensType lensMaterial lensCoating lensColor eye requestedQty quantity ' +
        'rightSpherical rightCylinder rightAddition leftSpherical leftCylinder leftAddition ' +
        'createdAt fulfillmentSource',
      )
      .lean();

    // ── Build per-SKU daily demand maps ────────────────────────────────────────
    const skuMap = new Map<string, SkuEntry>();

    for (const item of items) {
      if (!item.lensType || !item.lensMaterial) continue;

      const coating = item.lensCoating ?? '';
      const color = item.lensColor ?? '';
      // requestedQty captures true customer demand even when stock was short
      const demand = (item.requestedQty ?? item.quantity) || 1;
      const eye = item.eye ?? 'both';
      const dateStr = ((item as any).createdAt as Date).toISOString().slice(0, 10);

      type EyeData = { sph: number | null | undefined; cyl: number | null | undefined; add: number | null | undefined };
      const eyes: EyeData[] = [];
      if (eye === 'right' || eye === 'both') {
        eyes.push({ sph: item.rightSpherical, cyl: item.rightCylinder, add: item.rightAddition });
      }
      if (eye === 'left' || eye === 'both') {
        eyes.push({ sph: item.leftSpherical, cyl: item.leftCylinder, add: item.leftAddition });
      }
      // unfulfilled demand logs may have neither eye set — default to right
      if (eyes.length === 0) {
        eyes.push({ sph: item.rightSpherical, cyl: item.rightCylinder, add: item.rightAddition });
      }

      for (const { sph, cyl, add } of eyes) {
        if (sph == null) continue; // can't map to a stock SKU without spherical

        const key = skuKey(item.lensType, item.lensMaterial, coating, color, sph, cyl ?? 0, add ?? null);

        if (!skuMap.has(key)) {
          skuMap.set(key, {
            lensType: item.lensType,
            material: item.lensMaterial,
            coating,
            color,
            sph,
            cyl: cyl ?? 0,
            add: add ?? null,
            dailyMap: new Map(),
          });
        }

        const entry = skuMap.get(key)!;
        entry.dailyMap.set(dateStr, (entry.dailyMap.get(dateStr) ?? 0) + demand);
      }
    }

    if (skuMap.size === 0) {
      res.json({ count: 0, windowDays: days, leadTimeDays, results: [] });
      return;
    }

    // ── Fetch current stock for all relevant SKUs in one query ─────────────────
    const lensTypes = [...new Set([...skuMap.values()].map((e) => e.lensType))];
    const stockDocs = await LensStock.find({ lensType: { $in: lensTypes } })
      .select('lensType material coating color sph cyl add quantity')
      .lean();

    const stockMap = new Map<string, number>();
    for (const doc of stockDocs) {
      const k = skuKey(doc.lensType, doc.material, doc.coating, doc.color, doc.sph, doc.cyl, doc.add ?? null);
      stockMap.set(k, doc.quantity);
    }

    // ── Compute recommendations ────────────────────────────────────────────────
    type Flag = 'BUY NOW' | 'OK' | 'OVERSTOCKED';

    interface ReorderRow {
      sku: string;
      lensType: string;
      material: string;
      coating: string;
      color: string;
      sph: number;
      cyl: number;
      add: number | null;
      avgDailyDemand: number;
      stdDevDemand: number;
      safetyStock: number;
      reorderPoint: number;
      currentStock: number;
      recommendedPurchase: number;
      flag: Flag;
      totalDemand: number;
      windowDays: number;
      leadTimeDays: number;
    }

    const results: ReorderRow[] = [];

    for (const [key, entry] of skuMap) {
      // Build full daily array — 0 for each day with no demand
      const dailyDemand: number[] = Array.from({ length: days }, (_, i) => {
        const d = new Date(since);
        d.setDate(d.getDate() + i);
        return entry.dailyMap.get(d.toISOString().slice(0, 10)) ?? 0;
      });

      const avgDailyDemand = mean(dailyDemand);
      const stdDevDemand = stdDev(dailyDemand);
      const safetyStock = CONFIDENCE_Z * stdDevDemand * Math.sqrt(leadTimeDays);
      const reorderPoint = avgDailyDemand * leadTimeDays + safetyStock;

      const currentStock = stockMap.get(key) ?? 0;
      const incomingStock = 0; // no purchase order model; extend here when available
      const recommendedPurchase = Math.max(0, Math.ceil(reorderPoint - currentStock - incomingStock));

      let flag: Flag;
      if (currentStock < reorderPoint) flag = 'BUY NOW';
      else if (currentStock > reorderPoint * 2) flag = 'OVERSTOCKED';
      else flag = 'OK';

      results.push({
        sku: key,
        lensType: entry.lensType,
        material: entry.material,
        coating: entry.coating,
        color: entry.color,
        sph: entry.sph,
        cyl: entry.cyl,
        add: entry.add,
        avgDailyDemand: parseFloat(avgDailyDemand.toFixed(4)),
        stdDevDemand: parseFloat(stdDevDemand.toFixed(4)),
        safetyStock: parseFloat(safetyStock.toFixed(2)),
        reorderPoint: parseFloat(reorderPoint.toFixed(2)),
        currentStock,
        recommendedPurchase,
        flag,
        totalDemand: dailyDemand.reduce((s, v) => s + v, 0),
        windowDays: days,
        leadTimeDays,
      });
    }

    // Sort: BUY NOW first, then by recommendedPurchase desc
    const flagOrder: Record<Flag, number> = { 'BUY NOW': 0, 'OK': 1, 'OVERSTOCKED': 2 };
    results.sort((a, b) => {
      const fo = flagOrder[a.flag] - flagOrder[b.flag];
      return fo !== 0 ? fo : b.recommendedPurchase - a.recommendedPurchase;
    });

    res.json({ count: results.length, windowDays: days, leadTimeDays, results });
  } catch (error) {
    next(error);
  }
};
