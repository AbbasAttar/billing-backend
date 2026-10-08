import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { getAdminAuth } from '../lib/firebaseAdmin';
import { verifyCustomerToken } from '../lib/sessionToken';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAdmin when a valid staff Firebase ID token was sent. */
      admin?: { uid: string; email?: string };
      /** Set by attachCustomer when a valid customer session token was sent (digits-only phone). */
      customerPhone?: string;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

function reject(req: Request, res: Response, next: NextFunction, status: number, reason: string) {
  if (!env.AUTH_ENFORCE) {
    console.warn(`[AUTH] ${reason} — allowed (AUTH_ENFORCE off): ${req.method} ${req.originalUrl}`);
    return next();
  }
  res.status(status).json({ success: false, message: status === 401 ? 'Authentication required' : 'Forbidden' });
}

/**
 * Staff-only routes. Expects `Authorization: Bearer <Firebase ID token>` for a user who either
 * has the `admin: true` custom claim or whose verified email is listed in ADMIN_EMAILS.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return reject(req, res, next, 401, 'admin: no bearer token');

  const auth = getAdminAuth();
  if (!auth) return reject(req, res, next, 503, 'admin: Firebase Admin not configured');

  try {
    const decoded = await auth.verifyIdToken(token);
    const email = decoded.email?.toLowerCase();
    const allowed =
      decoded.admin === true ||
      (!!email && decoded.email_verified === true && env.ADMIN_EMAILS.includes(email));
    if (!allowed) return reject(req, res, next, 403, `admin: ${email ?? decoded.uid} is not an admin`);
    req.admin = { uid: decoded.uid, email };
    next();
  } catch {
    return reject(req, res, next, 401, 'admin: invalid or expired ID token');
  }
}

/** Reads an optional customer session token; never rejects. Use with customerPhoneFrom(). */
export function attachCustomer(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (token) {
    const phone = verifyCustomerToken(token);
    if (phone) req.customerPhone = phone;
  }
  next();
}

/**
 * Resolves which customer a storefront request acts for.
 * - Valid session token: its phone wins; any phone in the request must match it.
 * - No token and AUTH_ENFORCE off: falls back to the legacy phone param (logged).
 * Returns null (after sending 401/403) when the caller may not proceed.
 */
export function customerPhoneFrom(req: Request, res: Response, legacyPhone: unknown): string | null {
  const requested = typeof legacyPhone === 'string' ? legacyPhone.replace(/\D/g, '') : '';

  if (req.customerPhone) {
    if (requested && requested.slice(-10) !== req.customerPhone.slice(-10)) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return null;
    }
    return req.customerPhone;
  }

  if (!env.AUTH_ENFORCE && requested) {
    console.warn(`[AUTH] customer: no session token, using request phone — ${req.method} ${req.path}`);
    return requested;
  }

  res.status(401).json({ success: false, message: 'Authentication required' });
  return null;
}

/**
 * For single-document lookups by id: with a session token the document must belong to the
 * caller; without one it is only allowed (and logged) while AUTH_ENFORCE is off.
 */
export function customerOwns(req: Request, res: Response, ownerPhone: string | undefined): boolean {
  if (!req.customerPhone) {
    if (env.AUTH_ENFORCE) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return false;
    }
    console.warn(`[AUTH] customer: no session token for ${req.method} ${req.path}`);
    return true;
  }
  const owner = (ownerPhone ?? '').replace(/\D/g, '').slice(-10);
  if (!owner || owner !== req.customerPhone.slice(-10)) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return false;
  }
  return true;
}
