import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { getAdminAuth } from '../lib/firebaseAdmin';
import { verifyCustomerToken } from '../lib/sessionToken';
import { requiredRole, type StaffRole } from './accessPolicy';

export type { StaffRole } from './accessPolicy';

export interface StaffUser {
  uid: string;
  email?: string;
  role: StaffRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set when a valid Firebase ID token for a listed admin/staff user was sent. */
      user?: StaffUser;
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

/** admin > staff. */
const satisfies = (have: StaffRole, need: StaffRole) => have === 'admin' || need === 'staff';

/**
 * Role for a verified Firebase token: the `role` custom claim (or legacy `admin: true`) wins,
 * otherwise a verified email listed in ADMIN_EMAILS / STAFF_EMAILS. Null for anyone else.
 */
export function roleFor(decoded: { email?: string; email_verified?: boolean; role?: unknown; admin?: unknown }): StaffRole | null {
  if (decoded.role === 'admin' || decoded.admin === true) return 'admin';
  if (decoded.role === 'staff') return 'staff';
  const email = decoded.email?.toLowerCase();
  if (!email || decoded.email_verified !== true) return null;
  if (env.ADMIN_EMAILS.includes(email)) return 'admin';
  if (env.STAFF_EMAILS.includes(email)) return 'staff';
  return null;
}

type Resolved = { user: StaffUser } | { status: 401 | 403 | 503; reason: string };

async function resolveStaffUser(req: Request): Promise<Resolved> {
  const token = bearerToken(req);
  if (!token) return { status: 401, reason: 'no bearer token' };
  const auth = getAdminAuth();
  if (!auth) return { status: 503, reason: 'Firebase Admin not configured' };
  try {
    const decoded = await auth.verifyIdToken(token);
    const role = roleFor(decoded);
    const email = decoded.email?.toLowerCase();
    if (!role) return { status: 403, reason: `${email ?? decoded.uid} is not an admin or staff user` };
    return { user: { uid: decoded.uid, email, role } };
  } catch {
    return { status: 401, reason: 'invalid or expired ID token' };
  }
}

function deny(req: Request, res: Response, next: NextFunction, status: number, reason: string) {
  if (!env.STAFF_AUTH_ENFORCE) {
    console.warn(`[AUTH] ${reason} — allowed (STAFF_AUTH_ENFORCE off): ${req.method} ${req.originalUrl}`);
    return next();
  }
  res.status(status).json({ success: false, message: status === 401 ? 'Authentication required' : 'Forbidden' });
}

/** Route guard for a fixed minimum role. */
export function requireRole(need: StaffRole) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const r = await resolveStaffUser(req);
    if ('status' in r) return deny(req, res, next, r.status, `${need}: ${r.reason}`);
    req.user = r.user;
    if (!satisfies(r.user.role, need)) {
      return deny(req, res, next, 403, `${need}: ${r.user.email ?? r.user.uid} is ${r.user.role}`);
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');
export const requireStaff = requireRole('staff');

/**
 * Guard for the whole staff/admin API: the minimum role comes from the access policy table
 * (method + path), so one place decides what staff may do.
 */
export async function authorizeByPolicy(req: Request, res: Response, next: NextFunction) {
  const need = requiredRole(req.method, req.path);
  return requireRole(need)(req, res, next);
}

/** GET /me — who is signed in and with what role. Always needs a valid token (used by the admin app). */
export async function whoAmI(req: Request, res: Response) {
  const r = await resolveStaffUser(req);
  if ('status' in r) return res.status(r.status).json({ success: false, message: r.reason });
  res.json({ success: true, data: r.user });
}

/** True when the caller is a verified admin (for in-handler checks such as unlocking old records). */
export const isAdminRequest = (req: Request) => req.user?.role === 'admin';

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
 * - No token and CUSTOMER_AUTH_ENFORCE off: falls back to the legacy phone param (logged).
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

  if (!env.CUSTOMER_AUTH_ENFORCE && requested) {
    console.warn(`[AUTH] customer: no session token, using request phone — ${req.method} ${req.path}`);
    return requested;
  }

  res.status(401).json({ success: false, message: 'Authentication required' });
  return null;
}

/**
 * For single-document lookups by id: with a session token the document must belong to the
 * caller; without one it is only allowed (and logged) while CUSTOMER_AUTH_ENFORCE is off.
 */
export function customerOwns(req: Request, res: Response, ownerPhone: string | undefined): boolean {
  if (!req.customerPhone) {
    if (env.CUSTOMER_AUTH_ENFORCE) {
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
