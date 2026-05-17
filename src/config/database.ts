import mongoose from 'mongoose';
import { env } from './env';

const RETRY_INTERVAL_MS = 5000;
const MAX_RETRIES = 5;

export const connectDB = async (): Promise<void> => {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      const conn = await mongoose.connect(env.MONGODB_URI);
      console.log(`✅ MongoDB connected: ${conn.connection.host}`);
      return;
    } catch (error: any) {
      retries++;
      console.error(`❌ MongoDB connection attempt ${retries}/${MAX_RETRIES} failed: ${error.message}`);
      if (retries >= MAX_RETRIES) {
        console.error('🔴 Could not connect to MongoDB after max retries. Exiting.');
        process.exit(1);
      }
      console.log(`   Retrying in ${RETRY_INTERVAL_MS / 1000}s...`);
      await new Promise((res) => setTimeout(res, RETRY_INTERVAL_MS));
    }
  }
};
