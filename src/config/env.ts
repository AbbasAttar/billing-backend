import dotenv from 'dotenv';

dotenv.config({ override: true });

export const env = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/billing_system',
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  WABA_TOKEN: process.env.WABA_TOKEN ?? '',
  WABA_PHONE_NUMBER_ID: process.env.WABA_PHONE_NUMBER_ID ?? '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
};
