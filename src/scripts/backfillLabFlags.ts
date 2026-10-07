/**
 * One-time backfill: adds isLabItem / isOpenLabJob to every existing invoice item and marks
 * `meta/labFlagsBackfill` done, which switches the wholesaler queue from the legacy full scan
 * to native `where('isLabItem','==',true)` queries.
 *
 * Reads every invoice item once and writes only the items whose flags differ.
 * Safe to re-run (idempotent). Defaults to a DRY RUN that writes nothing.
 *
 *   npx ts-node --transpile-only src/scripts/backfillLabFlags.ts            # dry run
 *   npx ts-node --transpile-only src/scripts/backfillLabFlags.ts --apply    # write
 *
 * Take a Firestore export first:
 *   gcloud firestore export gs://<bucket>/backups/<date>-lab-flags --database=attarwala --collection-ids=invoiceitems
 */
import { getDb } from '../lib/firestoreDb';
import { computeLabFlags } from '../models/InvoiceItem.model';

const PAGE_SIZE = 300;
const apply = process.argv.includes('--apply');

async function run() {
  const db = getDb();
  const col = db.collection('invoiceitems');

  let scanned = 0;
  let toUpdate = 0;
  let labItems = 0;
  let openJobs = 0;
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
      const flags = computeLabFlags(data);
      if (flags.isLabItem) {
        labItems++;
        if (flags.isOpenLabJob) openJobs++;
      }

      if (data.isLabItem === flags.isLabItem && data.isOpenLabJob === flags.isOpenLabJob) continue;

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
    `[backfill] done. scanned=${scanned} updated=${apply ? toUpdate : 0} wouldUpdate=${toUpdate} ` +
      `labItems=${labItems} openJobs=${openJobs}`,
  );

  if (apply) {
    await db.collection('meta').doc('labFlagsBackfill').set({ done: true, at: new Date(), scanned });
    console.log('[backfill] marker meta/labFlagsBackfill written. Wholesaler queue now uses the flags.');
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
