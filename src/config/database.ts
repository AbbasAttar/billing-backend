import mongoose from 'mongoose';
import { env } from './env';

// Connection cache across serverless invocations within the same container
let cachedPromise: Promise<typeof mongoose> | null = null;
let isListenersAttached = false;

const MONGOOSE_OPTIONS: mongoose.ConnectOptions = {
  maxPoolSize: 10,
  minPoolSize: 1,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 30000,
  heartbeatFrequencyMS: 10000,
  maxIdleTimeMS: 30000,
  autoIndex: env.NODE_ENV !== 'production',
};

const attachConnectionListeners = () => {
  if (isListenersAttached) return;
  isListenersAttached = true;

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB connection disconnected.');
    cachedPromise = null;
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error event:', err.message);
    cachedPromise = null;
  });

  mongoose.connection.on('reconnected', () => {
    console.log('🔄 MongoDB reconnected successfully.');
  });
};

/**
 * Validates that an existing connection is genuinely alive and not a dead socket
 * after serverless container freeze/thaw cycles.
 */
const isConnectionAlive = async (): Promise<boolean> => {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return false;
  }

  try {
    // 1.5s ping timeout to detect dead TCP sockets immediately without hanging
    const pingPromise = mongoose.connection.db.admin().ping();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('MongoDB ping timed out')), 1500)
    );

    await Promise.race([pingPromise, timeoutPromise]);
    return true;
  } catch (err: any) {
    console.warn(`⚠️ Stale MongoDB socket detected (${err.message}). Forcing reconnect...`);
    return false;
  }
};

export const connectDB = async (): Promise<typeof mongoose> => {
  attachConnectionListeners();

  // 1. If connection exists and is ready, return immediately
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    return mongoose;
  }

  // If connection is disconnecting or disconnected, clean up cached promise
  if (mongoose.connection.readyState === 0 || mongoose.connection.readyState === 3) {
    cachedPromise = null;
  }

  // 2. If a connection attempt is already in progress, await it
  if (cachedPromise) {
    try {
      return await cachedPromise;
    } catch {
      cachedPromise = null;
    }
  }

  // 3. Initiate connection with retries
  const RETRY_INTERVAL_MS = 2000;
  const MAX_RETRIES = 3;

  cachedPromise = (async () => {
    let retries = 0;
    while (retries < MAX_RETRIES) {
      try {
        const conn = await mongoose.connect(env.MONGODB_URI, MONGOOSE_OPTIONS);
        console.log(`✅ MongoDB connected: ${conn.connection.host}`);
        return conn;
      } catch (error: any) {
        retries++;
        console.error(`❌ MongoDB connect attempt ${retries}/${MAX_RETRIES} failed: ${error.message}`);
        if (retries >= MAX_RETRIES) {
          cachedPromise = null;
          throw new Error(`Failed to connect to MongoDB after ${MAX_RETRIES} attempts: ${error.message}`);
        }
        await new Promise((res) => setTimeout(res, RETRY_INTERVAL_MS));
      }
    }
    throw new Error('Could not connect to MongoDB');
  })();

  return cachedPromise;
};


