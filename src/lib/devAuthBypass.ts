/**
 * LOCAL DEVELOPMENT ONLY: treat every request from this machine as the admin, so the admin app can
 * be opened without Google sign-in (e.g. in an embedded browser that cannot do the sign-in popup).
 *
 * On only when ALL of these hold:
 *  - DEV_AUTH_BYPASS=1, set in billing-backend/.env.local (gitignored, and left out of Firebase
 *    deploys in firebase.json — never put it in .env, which is deployed);
 *  - not running on Firebase / Cloud Run (K_SERVICE, FUNCTION_TARGET, FUNCTION_NAME unset);
 *  - the request comes straight from loopback (127.0.0.1 / ::1) with no proxy forwarding header.
 */
import type { Request } from 'express';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const isCloudRuntime = () => !!(process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.FUNCTION_NAME);

export const devAuthBypassOn = () => process.env.DEV_AUTH_BYPASS === '1' && !isCloudRuntime();

export function isDevBypassRequest(req: Pick<Request, 'socket' | 'headers'>): boolean {
  if (!devAuthBypassOn()) return false;
  if (req.headers['x-forwarded-for'] || req.headers['forwarded']) return false;
  return LOOPBACK.has(req.socket?.remoteAddress ?? '');
}

export const DEV_ADMIN = { uid: 'dev-local', email: 'dev@localhost', name: 'Local dev', role: 'admin' as const };
