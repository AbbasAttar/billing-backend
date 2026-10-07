import { FieldValue } from 'firebase-admin/firestore';
import { getDb, snapToData } from './firestoreDb';
import { getReadMeter, recordReads } from './readMeter';

/**
 * Collection mirrors: a whole small collection packed into a few `mirrors/*` documents.
 *
 * The Mongoose emulation answers `aggregate()`, `$lookup` and unindexed filters by downloading
 * the entire collection, which Firestore bills per document. For a mirrored collection those
 * scans read the mirror instead: 1–2 chunk docs on a cold instance, nothing on a warm one.
 *
 * Freshness is checked against the source once per HTTP request (re-checked after the request
 * itself writes to the collection; outside a request, at most once per MIRROR_FRESH_MS):
 *   - count()                           1 read  — detects deletions
 *   - where updatedAt > highWater - 60s  1+ reads — the docs written since the last sync
 * The wrapper stamps `updatedAt` on every create/update, so the delta query sees every write.
 * Deletions are listed in a tombstone doc by the wrapper's delete methods; anything the delta
 * and tombstones cannot explain (count mismatch) triggers a full rebuild, as does age > 24 h.
 *
 * Results are identical to a full scan because the mirror holds the same `snapToData` output
 * (minus the model's hidden fields such as searchTokens).
 */

const MIRROR_COLLECTION = 'mirrors';
const SCHEMA = 1;
const CHUNK_BYTES = 800_000; // Firestore caps a document at 1 MiB
const OVERLAP_MS = 60_000; // writes stamped before, but committed after, the newest doc seen
// Daily full rebuild as a safety net for writes that skip updatedAt (~4.5k reads/day today).
const MAX_AGE_MS = Number(process.env.MIRROR_MAX_AGE_MS ?? 86_400_000);
const FRESH_MS = Number(process.env.MIRROR_FRESH_MS ?? 3_000);
const SAVE_INTERVAL_MS = 60_000; // persist synced changes at most this often per collection
const DATE_KEY = '$__d';

interface MirrorConfig {
  hiddenFields: string[];
}

interface MirrorState {
  docs: Map<string, Record<string, any>>;
  highWater: number;
  builtAt: number;
  checkedAt: number;
  /** Last time the mirror was saved to Firestore by this instance (0 = never). */
  savedAt: number;
  /** In-memory changes not yet saved, and tombstones to clear once they are. */
  unsaved: boolean;
  pendingTombstones: string[];
}

const registry = new Map<string, MirrorConfig>();
const states = new Map<string, MirrorState>();
const inflight = new Map<string, { promise: Promise<MirrorState>; startedAt: number }>();
const storedChunks = new Map<string, number>();
const lastLocalWrite = new Map<string, number>();

export function registerMirror(colName: string, config: MirrorConfig): void {
  registry.set(colName, config);
}

export function isMirrored(colName: string): boolean {
  return registry.has(colName) && process.env.DISABLE_COLLECTION_MIRRORS !== 'true';
}

// ── Encoding ────────────────────────────────────────────────────────────────

function replacer(this: any, key: string, value: any) {
  const raw = this[key];
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return { [DATE_KEY]: Number.isNaN(ms) ? null : ms };
  }
  return value;
}

function reviver(_key: string, value: any) {
  if (value && typeof value === 'object' && !Array.isArray(value) && DATE_KEY in value && Object.keys(value).length === 1) {
    return value[DATE_KEY] === null ? new Date(NaN) : new Date(value[DATE_KEY]);
  }
  return value;
}

const encodeDoc = (doc: Record<string, any>) => JSON.stringify(doc, replacer);

function toMirrorDoc(col: string, data: Record<string, any>): Record<string, any> {
  const hidden = registry.get(col)?.hiddenFields ?? [];
  if (hidden.length === 0) return data;
  const copy = { ...data };
  for (const field of hidden) delete copy[field];
  return copy;
}

const updatedMs = (doc: Record<string, any>) => (doc.updatedAt instanceof Date ? doc.updatedAt.getTime() || 0 : 0);

const chunkRef = (col: string, i: number) => getDb().collection(MIRROR_COLLECTION).doc(`${col}__${i}`);
const metaRef = (col: string) => getDb().collection(MIRROR_COLLECTION).doc(col);
const tombstoneRef = (col: string) => getDb().collection(MIRROR_COLLECTION).doc(`${col}__deleted`);

// ── Storage ─────────────────────────────────────────────────────────────────

async function loadStored(col: string): Promise<MirrorState | null> {
  const metaSnap = await metaRef(col).get();
  recordReads(MIRROR_COLLECTION, 1);
  if (!metaSnap.exists) {
    storedChunks.set(col, 0);
    return null;
  }
  const meta = metaSnap.data() as {
    schema: number;
    gen: string;
    chunks: number;
    highWater: number;
    builtAt: number;
    savedAt?: number;
  };
  storedChunks.set(col, meta.chunks ?? 0);
  if (meta.schema !== SCHEMA || !meta.chunks) return null;

  const refs = Array.from({ length: meta.chunks }, (_, i) => chunkRef(col, i));
  const snaps = await getDb().getAll(...refs);
  recordReads(MIRROR_COLLECTION, refs.length);

  const docs = new Map<string, Record<string, any>>();
  for (const snap of snaps) {
    const chunk = snap.data();
    // A chunk from another generation means a concurrent save; the caller rebuilds.
    if (!chunk || chunk.gen !== meta.gen) return null;
    for (const doc of JSON.parse(chunk.data, reviver) as Record<string, any>[]) docs.set(doc.id, doc);
  }
  return {
    docs,
    highWater: meta.highWater ?? 0,
    builtAt: meta.builtAt ?? 0,
    checkedAt: 0,
    savedAt: meta.savedAt ?? 0,
    unsaved: false,
    pendingTombstones: [],
  };
}

async function persist(col: string, state: MirrorState): Promise<void> {
  const encoded = [...state.docs.values()].sort(byId).map(encodeDoc);

  const chunks: string[] = [];
  let current: string[] = [];
  let bytes = 2;
  for (const doc of encoded) {
    const size = Buffer.byteLength(doc) + 1;
    if (current.length > 0 && bytes + size > CHUNK_BYTES) {
      chunks.push(`[${current.join(',')}]`);
      current = [];
      bytes = 2;
    }
    current.push(doc);
    bytes += size;
  }
  chunks.push(`[${current.join(',')}]`);

  const gen = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const batch = getDb().batch();
  chunks.forEach((data, i) => batch.set(chunkRef(col, i), { gen, data }));
  const previous = storedChunks.get(col) ?? 0;
  for (let i = chunks.length; i < previous; i++) batch.delete(chunkRef(col, i));
  batch.set(metaRef(col), {
    schema: SCHEMA,
    gen,
    chunks: chunks.length,
    count: state.docs.size,
    highWater: state.highWater,
    builtAt: state.builtAt,
    savedAt: Date.now(),
  });
  await batch.commit();
  storedChunks.set(col, chunks.length);
}

// ── Sync ────────────────────────────────────────────────────────────────────

async function fullRebuild(col: string): Promise<MirrorState> {
  const colRef = getDb().collection(col);
  const docs = new Map<string, Record<string, any>>();
  let highWater = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  for (;;) {
    let q = colRef.orderBy('__name__').limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    recordReads(col, Math.max(snap.size, 1));
    if (snap.empty) break;
    for (const s of snap.docs) {
      const doc = toMirrorDoc(col, snapToData(s)!);
      docs.set(s.id, doc);
      highWater = Math.max(highWater, updatedMs(doc));
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
  }

  console.log(`[mirror] rebuilt "${col}" from source: ${docs.size} docs`);
  return { docs, highWater, builtAt: Date.now(), checkedAt: 0, savedAt: 0, unsaved: true, pendingTombstones: [] };
}

/** Applies writes and deletions since the last sync. Returns null when the mirror cannot be reconciled. */
async function sync(col: string, state: MirrorState): Promise<{ modified: boolean; tombstones: string[] } | null> {
  const colRef = getDb().collection(col);
  const since = new Date(Math.max(0, state.highWater - OVERLAP_MS));
  const [countSnap, changed] = await Promise.all([colRef.count().get(), colRef.where('updatedAt', '>', since).get()]);
  recordReads(col, 1 + Math.max(changed.size, 1));

  let modified = false;
  for (const snap of changed.docs) {
    const doc = toMirrorDoc(col, snapToData(snap)!);
    const prev = state.docs.get(snap.id);
    if (!prev || encodeDoc(prev) !== encodeDoc(doc)) {
      state.docs.set(snap.id, doc);
      modified = true;
    }
    state.highWater = Math.max(state.highWater, updatedMs(doc));
  }

  const count = countSnap.data().count;
  let tombstones: string[] = [];
  if (state.docs.size > count) {
    const tomb = await tombstoneRef(col).get();
    recordReads(MIRROR_COLLECTION, 1);
    tombstones = (tomb.data()?.ids as string[] | undefined) ?? [];
    for (const id of tombstones) {
      if (state.docs.delete(id)) modified = true;
    }
  }

  if (state.docs.size !== count) return null;
  return { modified, tombstones };
}

async function refresh(col: string): Promise<MirrorState> {
  let state = states.get(col) ?? (await loadStored(col)) ?? undefined;
  if (state && Date.now() - state.builtAt >= MAX_AGE_MS) state = undefined;

  if (state) {
    // One retry absorbs a write that landed between the count() and the delta query.
    let result = await sync(col, state);
    if (!result) result = await sync(col, state);
    if (result) {
      if (result.modified) state.unsaved = true;
      state.pendingTombstones.push(...result.tombstones);
    } else {
      console.warn(`[mirror] "${col}" out of step with source; rebuilding`);
      state = undefined;
    }
  }

  if (!state) state = await fullRebuild(col);

  state.checkedAt = Date.now();
  states.set(col, state);

  // Saving rewrites every chunk, so batch changes: at most once per SAVE_INTERVAL_MS. Until then
  // other instances catch up through the delta query (and the tombstones, which stay until saved).
  if (state.unsaved && Date.now() - state.savedAt >= SAVE_INTERVAL_MS) {
    try {
      const tombstones = state.pendingTombstones;
      await persist(col, state);
      state.savedAt = Date.now();
      state.unsaved = false;
      state.pendingTombstones = [];
      if (tombstones.length > 0) {
        await tombstoneRef(col).set({ ids: FieldValue.arrayRemove(...tombstones) }, { merge: true });
      }
    } catch (err: any) {
      // The in-memory mirror is still correct; the next instance re-syncs from source.
      console.error(`[mirror] failed to save "${col}":`, err?.message || err);
    }
  }
  return state;
}

function startRefresh(col: string): Promise<MirrorState> {
  const startedAt = Date.now();
  const promise = refresh(col).finally(() => {
    if (inflight.get(col)?.promise === promise) inflight.delete(col);
  });
  inflight.set(col, { promise, startedAt });
  return promise;
}

async function ensureFresh(col: string): Promise<MirrorState> {
  const request = getReadMeter();
  const state = states.get(col);

  if (state) {
    if (request ? request.mirrorsSynced.has(col) : Date.now() - state.checkedAt < FRESH_MS) return state;
  }

  // Share a sync already running, but only one that began after this request did: an older
  // sync may have run its queries before a write this request must see.
  const running = inflight.get(col);
  const notBefore = Math.max(request?.startedAt ?? 0, lastLocalWrite.get(col) ?? 0);
  let result: MirrorState;
  if (running && running.startedAt >= notBefore) {
    result = await running.promise;
  } else {
    if (running) await running.promise.catch(() => undefined);
    result = await startRefresh(col);
  }
  request?.mirrorsSynced.add(col);
  return result;
}

/** Called after a write through the wrapper: the rest of this request re-syncs before reading. */
export function noteMirrorWrite(col: string): void {
  if (!registry.has(col)) return;
  lastLocalWrite.set(col, Date.now());
  getReadMeter()?.mirrorsSynced.delete(col);
  const state = states.get(col);
  if (state) state.checkedAt = 0;
}

// ── Public API ──────────────────────────────────────────────────────────────

const byId = (a: Record<string, any>, b: Record<string, any>) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Every document of a mirrored collection, as fresh copies the caller may mutate, in document-id
 * order (Firestore's default order for an unordered query).
 */
export async function getMirrorDocs(
  col: string,
  predicate?: (doc: Record<string, any>) => boolean,
): Promise<Record<string, any>[]> {
  const state = await ensureFresh(col);
  const out: Record<string, any>[] = [];
  for (const doc of state.docs.values()) {
    if (!predicate || predicate(doc)) out.push(structuredClone(doc));
  }
  return out.sort(byId);
}

/** Copies of the mirrored documents with these ids (missing ids are skipped). */
export async function getMirrorDocsByIds(col: string, ids: string[]): Promise<Map<string, Record<string, any>>> {
  const state = await ensureFresh(col);
  const out = new Map<string, Record<string, any>>();
  for (const id of ids) {
    const doc = state.docs.get(id);
    if (doc) out.set(id, structuredClone(doc));
  }
  return out;
}

/** Called by the wrapper's delete methods so the next sync can drop these ids without a rebuild. */
export async function recordMirrorDeletes(col: string, ids: string[]): Promise<void> {
  if (!isMirrored(col) || ids.length === 0) return;
  try {
    await tombstoneRef(col).set({ ids: FieldValue.arrayUnion(...ids), at: new Date() }, { merge: true });
  } catch (err: any) {
    // Without a tombstone the next sync sees a count mismatch and rebuilds instead.
    console.error(`[mirror] failed to record deletes for "${col}":`, err?.message || err);
  }
}

/** Forces a rebuild from source and saves it (admin repair / scripts). */
export async function rebuildMirror(col: string): Promise<number> {
  if (storedChunks.get(col) === undefined) await loadStored(col);
  const state = await fullRebuild(col);
  state.checkedAt = Date.now();
  states.set(col, state);
  await persist(col, state);
  state.savedAt = Date.now();
  state.unsaved = false;
  await tombstoneRef(col).set({ ids: [] }, { merge: true });
  return state.docs.size;
}

export function mirroredCollections(): string[] {
  return [...registry.keys()];
}
