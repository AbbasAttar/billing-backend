import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Compact HMAC-signed customer session token: base64url(payload).base64url(signature).
 * Issued by /auth/login and /auth/register so storefront calls can prove which customer
 * they act for, instead of trusting a phone number sent in the query or body.
 */

const CUSTOMER_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days, matches the NextAuth session

interface CustomerTokenPayload {
  sub: string; // normalized phone (digits only)
  typ: 'customer';
  exp: number; // unix seconds
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function sign(data: string): string {
  return crypto.createHmac('sha256', env.CUSTOMER_TOKEN_SECRET).update(data).digest('base64url');
}

/** Constant-time string comparison; false when lengths differ. */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Returns undefined when CUSTOMER_TOKEN_SECRET is not configured. */
export function issueCustomerToken(phone: string): string | undefined {
  if (!env.CUSTOMER_TOKEN_SECRET) return undefined;
  const payload: CustomerTokenPayload = {
    sub: phone.replace(/\D/g, ''),
    typ: 'customer',
    exp: Math.floor(Date.now() / 1000) + CUSTOMER_TOKEN_TTL_SECONDS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Returns the customer's phone if the token is valid and unexpired, otherwise null. */
export function verifyCustomerToken(token: string): string | null {
  if (!env.CUSTOMER_TOKEN_SECRET || !token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, sign(body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as CustomerTokenPayload;
    if (payload.typ !== 'customer' || !payload.sub) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
