/**
 * One-time backfill: sets `expireAt` (the Firestore TTL field) on existing log documents so the
 * TTL policies in firestore.indexes.json can clean them up. New docs get it from model hooks.
 *
 *   marketingevents     createdAt   + 365 days
 *   automationlogs      triggeredAt + 180 days
 *   inventorysnapshots  snapshotDate + 365 days
 *
 * Idempotent; only docs without expireAt are written. Defaults to a DRY RUN.
 *   npx ts-node --transpile-only src/scripts/backfillExpireAt.ts
 *   npx ts-node --transpile-only src/scripts/backfillExpireAt.ts --apply
 */
import { getDb } from '../lib/firestoreDb';
import { expireAfterDays } from '../lib/firestoreModel';
import { MARKETING_EVENT_TTL_DAYS } from '../models/MarketingEvent.model';
import { AUTOMATION_LOG_TTL_DAYS } from '../models/AutomationLog.model';
import { INVENTORY_SNAPSHOT_TTL_DAYS } from '../models/InventorySnapshot.model';

const apply = process.argv.includes('--apply');

const TARGETS = [
  { collection: 'marketingevents', dateField: 'createdAt', days: MARKETING_EVENT_TTL_DAYS },
  { collection: 'automationlogs', dateField: 'triggeredAt', days: AUTOMATION_LOG_TTL_DAYS },
  { collection: 'inventorysnapshots', dateField: 'snapshotDate', days: INVENTORY_SNAPSHOT_TTL_DAYS },
];

async function run() {
  console.log(`[backfill] mode=${apply ? 'APPLY' : 'DRY RUN'}`);
  const db = getDb();
  for (const target of TARGETS) {
    const snap = await db.collection(target.collection).get();
    const missing = snap.docs.filter((d) => !d.data().expireAt);
    if (apply) {
      for (let i = 0; i < missing.length; i += 400) {
        const batch = db.batch();
        for (const doc of missing.slice(i, i + 400)) {
          const data = doc.data();
          const base = data[target.dateField]?.toDate?.() ?? data.createdAt?.toDate?.();
          batch.update(doc.ref, { expireAt: expireAfterDays(base, target.days) });
        }
        await batch.commit();
      }
    }
    console.log(`[backfill] ${target.collection}: scanned=${snap.size} ${apply ? 'updated' : 'wouldUpdate'}=${missing.length}`);
  }
  if (!apply) console.log('[backfill] dry run only. Re-run with --apply to write.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exit(1);
  });
