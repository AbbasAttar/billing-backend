import { getDb } from '../lib/firestoreDb';

export const connectDB = async (): Promise<any> => {
  // Returns the initialized Firestore DB instance (0ms overhead)
  const db = getDb();
  return db;
};
