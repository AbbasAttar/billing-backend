import { getAdminFirestore } from './firebaseAdmin';
import { Firestore, Timestamp } from 'firebase-admin/firestore';

let dbInstance: Firestore | null = null;

export function getDb(): Firestore {
  if (dbInstance) return dbInstance;
  const db = getAdminFirestore();
  if (!db) {
    throw new Error('Firestore DB has not been initialized. Check Firebase env credentials.');
  }
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (e) {
    // Settings already configured
  }
  dbInstance = db;
  return dbInstance;
}

// Convert Timestamps recursively to JS Date objects
export function convertTimestamps(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object' && 'toDate' in val && typeof val.toDate === 'function') {
    return val.toDate();
  }
  if (Array.isArray(val)) {
    return val.map(convertTimestamps);
  }
  if (typeof val === 'object' && (val.constructor === Object || !val.constructor)) {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = convertTimestamps(v);
    }
    return res;
  }
  return val;
}

// Convert Firestore doc snapshot to a clean JS object with id & _id
export function snapToData<T = any>(snap: FirebaseFirestore.DocumentSnapshot): T | null {
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const cleanData = convertTimestamps(data);
  const docId = snap.id;
  return {
    ...cleanData,
    id: docId,
    _id: docId, // Provide _id alias for legacy frontend/model compatibility
  } as T;
}

// Helper: Query documents with filters and pagination
export interface QueryOptions {
  where?: Array<[string, FirebaseFirestore.WhereFilterOp, any]>;
  orderBy?: string | [string, 'asc' | 'desc'];
  limit?: number;
  offset?: number;
}

export async function findDocs<T = any>(colName: string, options: QueryOptions = {}): Promise<T[]> {
  const db = getDb();
  let query: FirebaseFirestore.Query = db.collection(colName);

  if (options.where) {
    for (const [field, op, val] of options.where) {
      if (val !== undefined && val !== null) {
        query = query.where(field, op, val);
      }
    }
  }

  if (options.orderBy) {
    if (Array.isArray(options.orderBy)) {
      query = query.orderBy(options.orderBy[0], options.orderBy[1]);
    } else {
      query = query.orderBy(options.orderBy);
    }
  }

  if (options.offset) {
    query = query.offset(options.offset);
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => snapToData<T>(doc)!);
}

export async function getDocById<T = any>(colName: string, id: string): Promise<T | null> {
  if (!id) return null;
  const db = getDb();
  const snap = await db.collection(colName).doc(id).get();
  return snapToData<T>(snap);
}

export async function createDoc<T = any>(colName: string, data: any, customId?: string): Promise<T> {
  const db = getDb();
  const colRef = db.collection(colName);
  const docRef = customId ? colRef.doc(customId) : colRef.doc();

  const now = new Date();
  const payload = {
    ...data,
    createdAt: data.createdAt ? data.createdAt : now,
    updatedAt: now,
  };

  await docRef.set(payload, { merge: true });
  const snap = await docRef.get();
  return snapToData<T>(snap)!;
}

export async function updateDocById<T = any>(colName: string, id: string, updates: any): Promise<T | null> {
  const db = getDb();
  const docRef = db.collection(colName).doc(id);

  const payload = {
    ...updates,
    updatedAt: new Date(),
  };

  await docRef.update(payload);
  const snap = await docRef.get();
  return snapToData<T>(snap);
}

export async function deleteDocById(colName: string, id: string): Promise<boolean> {
  const db = getDb();
  await db.collection(colName).doc(id).delete();
  return true;
}

export async function countDocs(colName: string, where?: Array<[string, FirebaseFirestore.WhereFilterOp, any]>): Promise<number> {
  const db = getDb();
  let query: FirebaseFirestore.Query = db.collection(colName);

  if (where) {
    for (const [field, op, val] of where) {
      if (val !== undefined && val !== null) {
        query = query.where(field, op, val);
      }
    }
  }

  const snap = await query.count().get();
  return snap.data().count;
}
