/**
 * One-time backfill: writes `searchTokens` on every customer, frame, fragrance, optical lens and
 * contact lens, then marks `meta/searchTokens_<collection>` done, which switches that collection's
 * search from the legacy full-collection regex scan to Firestore array-contains.
 *
 * Idempotent; writes only documents whose tokens differ. Defaults to a DRY RUN.
 *
 *   npx ts-node --transpile-only src/scripts/backfillSearchTokens.ts            # dry run
 *   npx ts-node --transpile-only src/scripts/backfillSearchTokens.ts --apply    # write
 *   npx ts-node --transpile-only src/scripts/backfillSearchTokens.ts --apply --only=customers
 */
import { getDb } from '../lib/firestoreDb';
import { buildSearchTokens, type TokenSource } from '../lib/searchTokens';

const PAGE_SIZE = 300;
const apply = process.argv.includes('--apply');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

const TARGETS: Array<{ collection: string; extract: (d: Record<string, any>) => TokenSource }> = [
  { collection: 'customers', extract: (c) => ({ text: [c.name], numbers: [c.mobileNumber] }) },
  {
    collection: 'frames',
    extract: (f) => ({ text: [f.name, f.companyName, f.houseName], codes: [f.frameCode] }),
  },
  { collection: 'fragrances', extract: (f) => ({ text: [f.name, f.companyName] }) },
  { collection: 'opticallens', extract: (l) => ({ text: [l.name, l.brand, l.category] }) },
  { collection: 'contactlens', extract: (l) => ({ text: [l.name, l.brand] }) },
];

const sameTokens = (a: unknown, b: string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((t, i) => t === b[i]);

async function backfill(target: (typeof TARGETS)[number]) {
  const db = getDb();
  const col = db.collection(target.collection);
  let scanned = 0;
  let toUpdate = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = col.orderBy('__name__').limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let writes = 0;
    for (const doc of snap.docs) {
      scanned++;
      const tokens = buildSearchTokens(target.extract(doc.data()));
      if (sameTokens(doc.data().searchTokens, tokens)) continue;
      toUpdate++;
      if (apply) {
        batch.update(doc.ref, { searchTokens: tokens });
        writes++;
      }
    }
    if (apply && writes > 0) await batch.commit();
    last = snap.docs[snap.docs.length - 1];
  }

  console.log(`[backfill] ${target.collection}: scanned=${scanned} ${apply ? 'updated' : 'wouldUpdate'}=${toUpdate}`);

  if (apply) {
    await db.collection('meta').doc(`searchTokens_${target.collection}`).set({ done: true, at: new Date(), scanned });
  }
}

async function run() {
  console.log(`[backfill] mode=${apply ? 'APPLY' : 'DRY RUN'}`);
  for (const target of TARGETS) {
    if (only && only !== target.collection) continue;
    await backfill(target);
  }
  console.log(apply ? '[backfill] markers written. Search now uses searchTokens.' : '[backfill] dry run only. Re-run with --apply to write.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] failed:', err);
    process.exit(1);
  });
