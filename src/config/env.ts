import dotenv from 'dotenv';

// Tests must never pick up real secrets or Firebase credentials from .env.
if (!process.env.VITEST) dotenv.config({ override: true });

export const env = {
  PORT: parseInt(process.env.PORT || process.env.APP_PORT || '3001', 10),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/billing_system',
  NODE_ENV: process.env.NODE_ENV || 'development',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'https://attarwala-46200.web.app,https://attarwala-admin.web.app,https://attarwala-46200.firebaseapp.com,https://attarwala-admin.firebaseapp.com',
  WABA_TOKEN: process.env.WABA_TOKEN ?? '',
  WABA_PHONE_NUMBER_ID: process.env.WABA_PHONE_NUMBER_ID ?? '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ?? '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ?? '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  FIREBASE_PROJECT_ID: process.env.FB_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || '',
  FIREBASE_CLIENT_EMAIL: process.env.FB_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL || '',
  FIREBASE_PRIVATE_KEY: process.env.FB_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  // Auth
  // When false, missing/invalid credentials are logged ([AUTH] ...) but the request still proceeds,
  // so the admin app and storefront can be migrated to send tokens before enforcement is switched on.
  AUTH_ENFORCE: process.env.AUTH_ENFORCE === 'true',
  // Comma-separated Firebase Auth emails allowed to use the admin API (in addition to the `admin` custom claim).
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  CUSTOMER_TOKEN_SECRET: process.env.CUSTOMER_TOKEN_SECRET ?? '',
  INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET ?? '',
};

/**
 * True when deployed. Cloud Functions/Cloud Run always set K_SERVICE, and unlike NODE_ENV it
 * cannot be overridden by the deployed .env (which currently says NODE_ENV=development).
 */
export function isProduction(): boolean {
  return env.NODE_ENV === 'production' || !!process.env.K_SERVICE;
}

/**
 * Logs every missing security-relevant setting at startup. With AUTH_ENFORCE on, missing auth
 * secrets are fatal, because enforcement without them would lock everyone out.
 */
export function checkEnv(): void {
  const missing: string[] = [];
  if (!env.RAZORPAY_KEY_SECRET) missing.push('RAZORPAY_KEY_SECRET');
  if (!env.RAZORPAY_WEBHOOK_SECRET) missing.push('RAZORPAY_WEBHOOK_SECRET (webhooks will be rejected)');
  if (!env.CUSTOMER_TOKEN_SECRET) missing.push('CUSTOMER_TOKEN_SECRET (no customer session tokens)');
  if (!env.INTERNAL_API_SECRET) missing.push('INTERNAL_API_SECRET');
  if (env.ADMIN_EMAILS.length === 0) missing.push('ADMIN_EMAILS (only users with the admin claim can use the admin API)');
  if (missing.length) console.warn(`[ENV] Missing settings:\n  - ${missing.join('\n  - ')}`);

  if (env.AUTH_ENFORCE && !env.CUSTOMER_TOKEN_SECRET) {
    throw new Error('AUTH_ENFORCE=true requires CUSTOMER_TOKEN_SECRET');
  }
  if (!env.AUTH_ENFORCE) {
    console.warn('[ENV] AUTH_ENFORCE is off: unauthenticated admin/customer calls are logged, not blocked.');
  }
}

