import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { env } from '../config/env';

async function checkDatabases() {
  const adminApp = getApps().length > 0 ? getApps()[0] : initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });

  try {
    // Check default database
    const defaultDb = getFirestore(adminApp);
    const defaultCols = await defaultDb.listCollections();
    console.log(`📌 Firestore DB [(default)]: ${defaultCols.length} collections`);

    // Check databaseId 'attarwala' if it exists
    try {
      const attarwalaDb = getFirestore(adminApp, 'attarwala');
      const attarwalaCols = await attarwalaDb.listCollections();
      console.log(`📌 Firestore DB [attarwala]: ${attarwalaCols.length} collections`);
    } catch (e: any) {
      console.log('📌 Firestore DB [attarwala] check:', e.message);
    }
  } catch (err: any) {
    console.error('Error listing Firestore DBs:', err);
  }
  process.exit(0);
}

checkDatabases();
