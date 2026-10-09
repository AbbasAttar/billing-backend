import { Request } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Client IP for rate limiting. Cloud Functions sits behind Google's proxies, so the client IP is
 * the first X-Forwarded-For entry. Counters live in instance memory, so these limits are a
 * best-effort guard per instance rather than a hard global cap.
 */
export function clientIpKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function perMinute(limit: number) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: clientIpKey,
    validate: { trustProxy: false, xForwardedForHeader: false },
    handler: (_req, res) => {
      res.status(429).json({ message: 'Too many requests. Please slow down.' });
    },
  });
}

/**
 * /auth/*: slows password guessing and reauth-token abuse. NextAuth calls /auth/login from the
 * storefront server, so many customers can share one IP; keep this generous.
 */
export const authRateLimit = perMinute(Number(process.env.AUTH_RATE_LIMIT_PER_MIN) || 60);

/** /public/upload: anonymous checkout uploads write to Storage. */
export const uploadRateLimit = perMinute(Number(process.env.UPLOAD_RATE_LIMIT_PER_MIN) || 10);

/** /ai/*: every call costs LLM tokens. */
export const aiRateLimit = perMinute(Number(process.env.AI_RATE_LIMIT_PER_MIN) || 10);
