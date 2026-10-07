/**
 * One-time backfill: sets `isArchived: false` on frames and fragrances that have no isArchived
 * field, so "active" is explicit. Stamps `updatedAt` so collection mirrors pick the change up.
 *
 * Idempotent; touches only documents missing the field. Defaults to a DRY RUN.
 *
 *   npx ts-node --transpile-only src/scripts/backfillArchivedFlag.ts            # dry run
 *   npx ts-node --transpile-only src/scripts/backfillArchivedFlag.ts --apply    # write
 */
import { getDb } from '../lib/firestoreDb';

const apply = process.argv.includes('--apply');

async function backfill(collection: string) {
  const db = getDb();
  const snap = await db.collection(collection).get();
  const missing = snap.docs.filter((d) => d.data().isArchived === undefined);

  if (apply) {
    for (let i = 0; i < missing.length; i += 400) {
      const batch = db.batch();
      const now = new Date();
      for (const doc of missing.slice(i, i + 400)) batch.update(doc.ref, { isArchived: false, updatedAt: now });
      await batch.commit();
    }
  }
  console.log(`[backfill] ${collection}: scanned=${snap.size} ${apply ? 'updated' : 'wouldUpdate'}=${missing.length}`);
}

async function run() {
  console.log(`[backfill] mode=${apply ? 'APPLY' : 'DRY RUN'}`);
  for (const col of ['frames', 'fragrances']) await backfill(col);
  if (!apply) console.log('[backfill] dry run only. Re-run with --apply to write.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exit(1);
  });
