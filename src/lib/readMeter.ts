import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request Firestore read counter.
 *
 * Firestore bills per document read, so every code path that downloads documents
 * reports here via `recordReads`. The `readMeter` middleware logs a single
 * `[FS-READS]` line for any request that crosses the warn threshold, which lets
 * us find the endpoints that drive the bill from Cloud Logging.
 */
interface ReadStore {
  total: number;
  byCollection: Record<string, number>;
}

const als = new AsyncLocalStorage<ReadStore>();

export function runWithReadMeter<T>(fn: () => T): T {
  return als.run({ total: 0, byCollection: {} }, fn);
}

export function getReadMeter(): ReadStore | undefined {
  return als.getStore();
}

/** Record `count` billed document reads against `collection` (min 1 per query, as Firestore bills). */
export function recordReads(collection: string, count: number): void {
  const store = als.getStore();
  if (!store || !Number.isFinite(count) || count <= 0) return;
  store.total += count;
  store.byCollection[collection] = (store.byCollection[collection] || 0) + count;
}

const warned = new Set<string>();

export function isStrictFirestore(): boolean {
  return process.env.STRICT_FIRESTORE === 'true';
}

/**
 * Flag an operation that downloads more than it returns (full scans, in-memory aggregation).
 * Throws when STRICT_FIRESTORE=true, otherwise logs once per operation per instance.
 */
export function flagExpensiveOp(key: string, message: string, throwWhenStrict = true): void {
  const full = `[FS-EXPENSIVE] ${key}: ${message}`;
  if (throwWhenStrict && isStrictFirestore()) {
    throw new Error(full);
  }
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(full);
  }
}
