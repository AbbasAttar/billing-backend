/**
 * Temporary: checks mirror read-your-writes on a throwaway collection, then removes it.
 *   npx ts-node --transpile-only src/scripts/mirrorWriteTest.ts
 */
import { createFirestoreModel } from '../lib/firestoreModel';
import { runWithReadMeter, getReadMeter } from '../lib/readMeter';
import { getDb } from '../lib/firestoreDb';

const COL = 'mirrortests';
const T = createFirestoreModel<any>(COL, { mirror: true });

let failures = 0;
const check = (label: string, ok: boolean, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
};

/** Each call runs as its own "request". */
const request = <R>(fn: () => Promise<R>) => runWithReadMeter(async () => {
  const result = await fn();
  return { result, reads: getReadMeter()!.total };
});

const names = async () => ((await T.find({ kind: 'test' }).sort({ n: 1 })) as any[]).map((d) => d.name);

async function run() {
  // Seed via a first request (also builds the mirror).
  await request(async () => {
    await T.create({ kind: 'test', name: 'a', n: 1 });
    await T.create({ kind: 'test', name: 'b', n: 2 });
  });

  let r = await request(names);
  check('reads see seeded docs', JSON.stringify(r.result) === '["a","b"]', `${r.result} reads=${r.reads}`);

  r = await request(names);
  check('warm request costs few reads', r.reads <= 3, `reads=${r.reads}`);

  // Write then read inside the same request.
  r = await request(async () => {
    await names(); // syncs first
    await T.create({ kind: 'test', name: 'c', n: 3 });
    return names();
  });
  check('same-request read sees create', JSON.stringify(r.result) === '["a","b","c"]', String(r.result));

  // Update in one request, read in the next.
  const docs: any[] = await T.find({ kind: 'test' });
  const b = docs.find((d) => d.name === 'b');
  await request(() => T.findByIdAndUpdate(b.id, { $set: { name: 'B', n: 10 } }));
  r = await request(names);
  check('next request sees update', JSON.stringify(r.result) === '["a","c","B"]', String(r.result));

  // Aggregate over the mirror.
  const agg = await request(() => T.aggregate([{ $match: { kind: 'test' } }, { $group: { _id: null, total: { $sum: '$n' } } }]));
  check('aggregate sums mirror', (agg.result as any)[0]?.total === 14, JSON.stringify(agg.result));

  // Delete one: tombstone path.
  await request(() => T.findByIdAndDelete(b.id));
  r = await request(names);
  check('next request drops deleted doc', JSON.stringify(r.result) === '["a","c"]', `${r.result} reads=${r.reads}`);

  // Write that bypasses the wrapper's notes but stamps updatedAt (another instance's write).
  const a = (await T.find({ kind: 'test' }) as any[]).find((d) => d.name === 'a');
  await getDb().collection(COL).doc(a.id).set({ name: 'A', updatedAt: new Date() }, { merge: true });
  r = await request(names);
  check('picks up external write via delta', JSON.stringify(r.result) === '["A","c"]', String(r.result));

  // Delete without a tombstone (count mismatch -> rebuild).
  await getDb().collection(COL).doc(a.id).delete();
  r = await request(names);
  check('count mismatch triggers rebuild', JSON.stringify(r.result) === '["c"]', `${r.result} reads=${r.reads}`);
}

async function cleanup() {
  const db = getDb();
  const snap = await db.collection(COL).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  const mirrors = await db.collection('mirrors').where('__name__', '>=', db.collection('mirrors').doc(COL)).where('__name__', '<', db.collection('mirrors').doc(`${COL}~`)).get();
  await Promise.all(mirrors.docs.map((d) => d.ref.delete()));
  console.log(`cleanup: removed ${snap.size} test docs, ${mirrors.size} mirror docs`);
}

run()
  .catch((err) => { failures++; console.error(err); })
  .finally(async () => {
    await cleanup();
    console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
    process.exit(failures ? 1 : 0);
  });
