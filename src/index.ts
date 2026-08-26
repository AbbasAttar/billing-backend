import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

// 1. Cloud Function HTTP API (Express REST API)
export const api = onRequest(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 60,
    cors: true,
  },
  async (req, res) => {
    const { connectDB } = await import('./config/database');
    const { default: app } = await import('./app');
    await connectDB();
    return app(req, res);
  }
);

// 2. Scheduled Function: Nightly Marketing Automation (Daily at 09:00 IST)
export const nightlyMarketingCron = onSchedule(
  {
    schedule: '0 9 * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
  },
  async () => {
    console.log('⏰ Running scheduled nightly marketing intelligence automations...');
    const { connectDB } = await import('./config/database');
    const { runAllActiveRules } = await import('./services/automationEngine');
    await connectDB();
    await runAllActiveRules();
    console.log('✅ Nightly marketing intelligence automations complete.');
  }
);
