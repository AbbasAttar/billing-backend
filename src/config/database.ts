import mongoose from 'mongoose';
import { env } from './env';

// Cache the connection promise in global scope across serverless invocations
let cachedPromise: Promise<typeof mongoose> | null = null;
let isListenersAttached = false;

const MONGOOSE_OPTIONS: mongoose.ConnectOptions = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  autoIndex: env.NODE_ENV !== 'production',
};

const attachConnectionListeners = () => {
  if (isListenersAttached) return;
  isListenersAttached = true;

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected. Resetting cached promise...');
    cachedPromise = null;
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err.message);
    cachedPromise = null;
  });

  mongoose.connection.on('reconnected', () => {
    console.log('🔄 MongoDB reconnected successfully.');
  });
};

export const connectDB = async (): Promise<typeof mongoose> => {
  attachConnectionListeners();

  // 1. If connection is fully active and ready, reuse it immediately (0ms overhead)
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    return mongoose;
  }

  // 2. If a connection attempt is already in progress, await it
  if (cachedPromise) {
    return cachedPromise;
  }

  // 3. Otherwise, create a fresh connection
  console.log('🔌 Establishing fresh MongoDB connection...');
  cachedPromise = mongoose
    .connect(env.MONGODB_URI, MONGOOSE_OPTIONS)
    .then((mongooseInstance) => {
      console.log(`✅ MongoDB connected: ${mongooseInstance.connection.host}`);
      return mongooseInstance;
    })
    .catch((err) => {
      cachedPromise = null; // Reset cache on failure so next request can retry
      console.error('❌ MongoDB connection error:', err.message);
      throw err;
    });

  return cachedPromise;
};
