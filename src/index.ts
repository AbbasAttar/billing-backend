import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import app from './app';
import { connectDB } from './config/database';

// 1. Cloud Function HTTP API (Express REST API)
export const api = onRequest(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 60,
    minInstances: 0, // Scale down to 0 instances when idle to eliminate continuous GCP/Cloud Run charges
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
        error: 'Backend service initializing. Please retry in a few seconds.',
        message: error.message,
      });
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


