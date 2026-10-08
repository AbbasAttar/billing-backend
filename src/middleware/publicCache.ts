import { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { clientIpKey } from './rateLimits';

/**
 * CDN cache headers for read-only public catalog endpoints.
 *
 * Firebase Hosting's CDN caches responses that carry `s-maxage`, so repeated storefront
 * requests are served without invoking the Cloud Function or touching Firestore.
 * Only successful (200) responses are cacheable; errors are marked `no-store`.
 */
export function publicCache(sMaxAgeSeconds = 300, staleWhileRevalidateSeconds = 600): RequestHandler {
  const cacheable = `public, max-age=60, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`;

  return (_req: Request, res: Response, next: NextFunction) => {
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      if (!res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', res.statusCode === 200 ? cacheable : 'no-store');
      }
      return json(body);
    };
    next();
  };
}

/**
 * Per-IP rate limit for /api/public/*, so crawlers and scrapers cannot run up Firestore reads.
 * Counters live in instance memory, so this is a best-effort guard rather than a hard global cap.
 * The default is generous because the storefront's server-side rendering calls the API from a
 * small pool of Google IPs; tune with PUBLIC_RATE_LIMIT_PER_MIN.
 */
export const publicRateLimit = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.PUBLIC_RATE_LIMIT_PER_MIN) || 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  validate: { trustProxy: false, xForwardedForHeader: false },
  handler: (_req, res) => {
    res.status(429).json({ message: 'Too many requests. Please slow down.' });
  },
});
