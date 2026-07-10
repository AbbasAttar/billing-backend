import cron from 'node-cron';
import { runAllActiveRules, type RuleRunResult } from './automationEngine';

let isRunning = false;

async function executeRules(): Promise<RuleRunResult[]> {
  if (isRunning) {
    console.log('[Cron] Skipping — previous job still in progress');
    return [];
  }
  isRunning = true;
  console.log('[Cron] Starting automation run…');
  try {
    const results = await runAllActiveRules();
    const totalSent = results.reduce((s, r) => s + r.sent, 0);
    console.log(`[Cron] Done. ${results.length} rule(s) processed, ${totalSent} message(s) sent.`);
    return results;
  } catch (err) {
    console.error('[Cron] Unhandled error:', err);
    return [];
  } finally {
    isRunning = false;
  }
}

// Runs every day at 9:00 AM IST (good time to trigger re-engagement)
export function startCron() {
  cron.schedule('0 9 * * *', () => { executeRules(); }, { timezone: 'Asia/Kolkata' });
  console.log('[Cron] Nightly automation scheduled — runs daily at 09:00 IST');
}

export function triggerManualRun(): Promise<RuleRunResult[]> {
  return executeRules();
}
