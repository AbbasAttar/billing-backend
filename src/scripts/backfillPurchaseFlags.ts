/**
 * One-time backfill: adds isLedger / isPending to every existing purchase entry and marks
 * `meta/purchaseFlagsBackfill` done, which switches GET /purchases from the legacy full scan
 * to native `where('isLedger'|'isPending','==',true)` queries.
 *
 * Idempotent; writes only entries whose flags differ. Defaults to a DRY RUN.
 *
 *   npx ts-node --transpile-only src/scripts/backfillPurchaseFlags.ts            # dry run
 *   npx ts-node --transpile-only src/scripts/backfillPurchaseFlags.ts --apply    # write
 */
import { getDb } from '../lib/firestoreDb';
import { computePurchaseFlags } from '../models/PurchaseEntry.model';

const PAGE_SIZE = 300;
const apply = process.argv.includes('--apply');

async function run() {
  const db = getDb();
  const col = db.collection('purchaseentries');

  let scanned = 0;
  let toUpdate = 0;
  let ledger = 0;
  let pending = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  console.log(`[backfill] mode=${apply ? 'APPLY' : 'DRY RUN'}`);

  for (;;) {
    let q = col.orderBy('__name__').limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchWrites = 0;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();
      const flags = computePurchaseFlags(data);
      if (flags.isLedger) ledger++;
      if (flags.isPending) pending++;

      if (data.isLedger === flags.isLedger && data.isPending === flags.isPending) continue;

      toUpdate++;
      if (apply) {
        batch.update(doc.ref, flags);
        batchWrites++;
      }
    }

    if (apply && batchWrites > 0) await batch.commit();
    last = snap.docs[snap.docs.length - 1];
    console.log(`[backfill] scanned=${scanned} toUpdate=${toUpdate}`);
  }

  console.log(
    `[backfill] done. scanned=${scanned} updated=${apply ? toUpdate : 0} wouldUpdate=${toUpdate} ledger=${ledger} pending=${pending}`,
  );

  if (apply) {
    await db.collection('meta').doc('purchaseFlagsBackfill').set({ done: true, at: new Date(), scanned });
    console.log('[backfill] marker meta/purchaseFlagsBackfill written. Purchases now use the flags.');
  } else {
    console.log('[backfill] dry run only. Re-run with --apply to write.');
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exit(1);
  });
