import mongoose from 'mongoose';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { env } from '../config/env';

// Initialize Firebase Admin
const adminApp = getApps().length > 0 ? getApps()[0] : initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});
const db = getFirestore(adminApp, 'attarwala');

// Recursive sanitizer to prepare MongoDB documents for Firestore write
function sanitizeForFirestore(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (obj instanceof mongoose.Types.ObjectId) {
    return obj.toString();
  }
  if (obj instanceof Date) {
    return Timestamp.fromDate(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore).filter((v) => v !== undefined);
  }
  if (typeof obj === 'object') {
    // If it's a plain object or Mongoose document
    const cleanObj: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val === undefined) continue;
      if (key === '__v') continue; // Skip Mongoose version key
      if (key === '_id') {
        cleanObj._id = val ? val.toString() : '';
        continue;
      }
      cleanObj[key] = sanitizeForFirestore(val);
    }
    return cleanObj;
  }
  return obj;
}

async function migrateCollection(collectionName: string, mongoDb: mongoose.mongo.Db) {
  console.log(`\n📦 Migrating collection: [${collectionName}]...`);
  const docs = await mongoDb.collection(collectionName).find({}).toArray();
  if (docs.length === 0) {
    console.log(` ℹ️ [${collectionName}] is empty. Skipping.`);
    return 0;
  }

  const firestoreCol = db.collection(collectionName);
  const BATCH_SIZE = 400; // Firestore limit is 500 ops per batch
  let migratedCount = 0;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const doc of chunk) {
      const docId = doc._id ? doc._id.toString() : firestoreCol.doc().id;
      const sanitizedDoc = sanitizeForFirestore(doc);
      // Remove top-level _id if present or keep id
      delete sanitizedDoc._id;
      sanitizedDoc.id = docId;

      const docRef = firestoreCol.doc(docId);
      batch.set(docRef, sanitizedDoc, { merge: true });
    }

    await batch.commit();
    migratedCount += chunk.length;
    console.log(`   ⏳ Migrated ${migratedCount}/${docs.length} docs in [${collectionName}]`);
  }

  console.log(` ✅ Completed [${collectionName}]: ${migratedCount} docs migrated to Firestore.`);
  return migratedCount;
}

async function runMigration() {
  console.log('🚀 Starting MongoDB -> Firestore Migration Strategy for project:', env.FIREBASE_PROJECT_ID);
  console.log('Connecting to MongoDB...');
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('✅ Connected to MongoDB Atlas.');

  const mongoDb = mongoose.connection.db;
  if (!mongoDb) {
    throw new Error('MongoDB database instance unavailable.');
  }

  const collections = await mongoDb.listCollections().toArray();
  console.log(`Found ${collections.length} collections in MongoDB.`);

  let totalMigrated = 0;
  const summary: Record<string, number> = {};

  for (const col of collections) {
    const count = await migrateCollection(col.name, mongoDb);
    summary[col.name] = count;
    totalMigrated += count;
  }

  console.log('\n==================================================');
  console.log('🎉 MIGRATION SUMMARY COMPLETE');
  console.log('==================================================');
  console.table(summary);
  console.log(`Total documents transferred to Firestore: ${totalMigrated}`);

  await mongoose.disconnect();
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
