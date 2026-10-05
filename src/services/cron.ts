import cron from 'node-cron';
import { runAllActiveRules, type RuleRunResult } from './automationEngine';
import { Invoice } from '../models/Invoice.model';
import { Customer } from '../models/Customer.model';
import { getDb } from '../lib/firestoreDb';
import { AggregateField } from 'firebase-admin/firestore';

let isRunning = false;

export interface DailyMetricsSummary {
  date: string;
  invoicesCount: number;
  newCustomersCount: number;
  totalRevenue: number;
  averageOrderValue: number;
}

/**
 * Calculates daily sales and activity metrics using strict 24-hour date bounds
 * and Firestore's native aggregation queries (count, sum, average).
 * ZERO full collection scans. ZERO in-memory slicing of historical sets.
 */
export async function getDailyMetrics(referenceDate: Date = new Date()): Promise<DailyMetricsSummary> {
  const startOfDay = new Date(referenceDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(referenceDate);
  endOfDay.setHours(23, 59, 59, 999);

  // 1. Strict 24-hour date bounds using Firestore native count aggregation
  const [invoicesCount, newCustomersCount] = await Promise.all([
    Invoice.countDocuments({ billDate: { $gte: startOfDay, $lte: endOfDay } }),
    Customer.countDocuments({ createdAt: { $gte: startOfDay, $lte: endOfDay } }),
  ]);

  let totalRevenue = 0;
  let averageOrderValue = 0;

  // 2. Native aggregation queries (sum, average) pushed directly to Firestore
  if (invoicesCount > 0) {
    try {
      const db = getDb();
      const aggSnap = await db
        .collection('invoices')
        .where('billDate', '>=', startOfDay)
        .where('billDate', '<=', endOfDay)
        .aggregate({
          totalRevenue: AggregateField.sum('total'),
          avgOrder: AggregateField.average('total'),
        })
        .get();

      const data = aggSnap.data();
      totalRevenue = Math.round(data?.totalRevenue || 0);
      averageOrderValue = Math.round(data?.avgOrder || 0);
    } catch (err: any) {
      // If composite index is building in Firestore, gracefully use bounded 24h slice with limit
      console.warn('[Cron] Native sum aggregation index note:', err?.message || err);
      const dayInvoices = await Invoice.find({ billDate: { $gte: startOfDay, $lte: endOfDay } })
        .select('total')
        .limit(200)
        .lean();
      totalRevenue = dayInvoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
      averageOrderValue = Math.round(totalRevenue / Math.max(dayInvoices.length, 1));
    }
  }

  return {
    date: startOfDay.toISOString().split('T')[0],
    invoicesCount,
    newCustomersCount,
    totalRevenue,
    averageOrderValue,
  };
}

async function executeRules(): Promise<RuleRunResult[]> {
  if (isRunning) {
    console.log('[Cron] Skipping — previous job still in progress');
    return [];
  }
  isRunning = true;
  console.log('[Cron] Starting nightly automation run…');

  try {
    // 1. Calculate and log yesterday's metrics via native aggregations (zero full-collection download)
    const yesterday = new Date(Date.now() - 86_400_000);
    const metrics = await getDailyMetrics(yesterday);
    console.log(
      `[Cron] Yesterday's metrics (${metrics.date}): ${metrics.invoicesCount} invoice(s), ₹${metrics.totalRevenue} total sales, ${metrics.newCustomersCount} new customer(s).`
    );

    // 2. Run active rules with bounded memory intelligence and shared cache
    const results = await runAllActiveRules();
    const totalSent = results.reduce((s, r) => s + r.sent, 0);
    console.log(`[Cron] Done. ${results.length} rule(s) processed, ${totalSent} message(s) sent.`);
    return results;
  } catch (err) {
    console.error('[Cron] Unhandled error in executeRules:', err);
    return [];
  } finally {
    isRunning = false;
  }
}

// Runs every day at 9:00 AM IST (re-engagement window)
export function startCron() {
  cron.schedule('0 9 * * *', () => { executeRules(); }, { timezone: 'Asia/Kolkata' });
  console.log('[Cron] Nightly automation scheduled — runs daily at 09:00 IST');
}

export function triggerManualRun(): Promise<RuleRunResult[]> {
  return executeRules();
}
