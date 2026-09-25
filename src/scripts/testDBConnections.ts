import mongoose from 'mongoose';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../config/env';

console.log('Testing connection to MongoDB:', env.MONGODB_URI.substring(0, 35) + '...');

async function testConnections() {
  try {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('✅ MongoDB connected successfully!');
    const db = mongoose.connection.db;
    if (db) {
      const collections = await db.listCollections().toArray();
      console.log(`Found ${collections.length} MongoDB collections.`);
    }
    await mongoose.disconnect();
  } catch (err: any) {
    console.error('❌ MongoDB Connection failed:', err.message);
  }

  try {
    console.log('\nTesting Firestore connection...');
    const adminApp = getApps().length > 0 ? getApps()[0] : initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    const firestore = getFirestore(adminApp);
    const collections = await firestore.listCollections();
    console.log(`✅ Firestore connected successfully to project [${env.FIREBASE_PROJECT_ID}]! Found ${collections.length} collections.`);
    for (const col of collections) {
      console.log(` - Firestore Collection: ${col.id}`);
    }
  } catch (err: any) {
    console.error('❌ Firestore Connection failed:', err.message);
  }
  process.exit(0);
}

testConnections();
