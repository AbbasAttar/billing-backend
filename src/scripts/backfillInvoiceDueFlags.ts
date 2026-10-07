/**
 * One-time backfill: adds paidAmount / balance / hasDue to every existing invoice and
 * marks `meta/invoiceDueBackfill` done, which switches GET /invoices/merged?due=1 from the
 * legacy full scan to the native `where('hasDue','==',true)` query.
 *
 * Reads every invoice once and writes only the invoices whose derived fields differ.
 * Safe to re-run (idempotent). Defaults to a DRY RUN that writes nothing.
 *
 *   npx ts-node --transpile-only src/scripts/backfillInvoiceDueFlags.ts            # dry run
 *   npx ts-node --transpile-only src/scripts/backfillInvoiceDueFlags.ts --apply    # write
 *
 * Take a Firestore export first:  gcloud firestore export gs://<bucket>/backups/<date>-invoice-due
 */
import { getDb } from '../lib/firestoreDb';
import { computeInvoiceDueFields } from '../models/Invoice.model';

const PAGE_SIZE = 300;
const apply = process.argv.includes('--apply');

async function run() {
  const db = getDb();
  const col = db.collection('invoices');

  let scanned = 0;
  let toUpdate = 0;
  let skippedNoData = 0;
  let dueCount = 0;
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
      const derived = computeInvoiceDueFields({ payments: data.payments, total: data.total });
      if (!derived) {
        skippedNoData++;
        continue;
      }
      if (derived.hasDue) dueCount++;

      const same =
        data.paidAmount === derived.paidAmount &&
        data.balance === derived.balance &&
        data.hasDue === derived.hasDue;
      if (same) continue;

      toUpdate++;
      if (apply) {
        batch.update(doc.ref, derived);
        batchWrites++;
      }
    }

    if (apply && batchWrites > 0) await batch.commit();
    last = snap.docs[snap.docs.length - 1];
    console.log(`[backfill] scanned=${scanned} toUpdate=${toUpdate}`);
  }

  console.log(
    `[backfill] done. scanned=${scanned} updated=${apply ? toUpdate : 0} wouldUpdate=${toUpdate} ` +
      `withDue=${dueCount} skippedNoPaymentsOrTotal=${skippedNoData}`,
  );

  if (apply) {
    await db.collection('meta').doc('invoiceDueBackfill').set({ done: true, at: new Date(), scanned });
    console.log('[backfill] marker meta/invoiceDueBackfill written. due queries now use hasDue.');
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
