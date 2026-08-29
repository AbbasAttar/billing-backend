import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import app from './app';
import { connectDB } from './config/database';

// 0. Pre-warm MongoDB connection on container initialization
connectDB().catch((err) => {
  console.warn('⚠️ Background pre-warm DB connect notice:', err.message);
});

// 1. Cloud Function HTTP API (Express REST API)
export const api = onRequest(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 60,
    minInstances: 1, // Keep 1 instance always warm to eliminate cold starts and sleep
    maxInstances: 10,
    concurrency: 80,
    cors: true,
  },
  async (req, res) => {
    try {
      await connectDB();
      return app(req, res);
    } catch (error: any) {
      console.error('🔴 Critical error in API handler:', error);
      return res.status(503).json({
        success: false,
        error: 'Database connection currently reconnecting. Please retry in a few seconds.',
        message: error.message,
      });
    }
  }
);

// 2. Keep-Warm Heartbeat Function (Runs every 5 minutes to keep API container warm)
export const keepWarmPing = onSchedule(
  {
    schedule: '*/5 * * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
  },
  async () => {
    try {
      const resp = await fetch('https://asia-south1-attarwala-46200.cloudfunctions.net/api/health');
      const data = await resp.json();
      console.log('💓 Keep-warm heartbeat pinged api successfully:', data);
    } catch (err: any) {
      console.error('❌ Keep-warm heartbeat failed:', err.message);
    }
  }
);

// 3. Scheduled Function: Nightly Marketing Automation (Daily at 09:00 IST)
export const nightlyMarketingCron = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
  },
  async () => {
    console.log('⏰ Running scheduled nightly marketing intelligence automations...');
    const { runAllActiveRules } = await import('./services/automationEngine');
    await connectDB();
    await runAllActiveRules();
    console.log('✅ Nightly marketing intelligence automations complete.');
  }
);

