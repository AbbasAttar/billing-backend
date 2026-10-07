import { getDb } from './firestoreDb';
import { recordReads } from './readMeter';

const done = new Set<string>();

/**
 * True once a backfill script has written `meta/<name>` with `done: true`.
 * Queries that depend on backfilled flags use this to fall back to the legacy scan until then.
 * Only a positive answer is cached, so the switch happens without a restart.
 */
export async function isBackfillDone(name: string): Promise<boolean> {
  if (done.has(name)) return true;
  const snap = await getDb().collection('meta').doc(name).get();
  recordReads('meta', 1);
  if (snap.exists && snap.data()?.done === true) {
    done.add(name);
    return true;
  }
  return false;
}
