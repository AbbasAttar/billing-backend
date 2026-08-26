import dotenv from 'dotenv';

dotenv.config({ override: true });

export const env = {
  PORT: parseInt(process.env.PORT || process.env.APP_PORT || '3001', 10),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/billing_system',
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000,http://localhost:3002',
  WABA_TOKEN: process.env.WABA_TOKEN ?? '',
  WABA_PHONE_NUMBER_ID: process.env.WABA_PHONE_NUMBER_ID ?? '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ?? '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ?? '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  FIREBASE_PROJECT_ID: process.env.FB_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '',
  FIREBASE_CLIENT_EMAIL: process.env.FB_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || '',
  FIREBASE_PRIVATE_KEY: process.env.FB_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || '',
};

