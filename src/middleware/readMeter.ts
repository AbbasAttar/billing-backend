import { Request, Response, NextFunction } from 'express';
import { getReadMeter, runWithReadMeter } from '../lib/readMeter';

const WARN_THRESHOLD = Number(process.env.FS_READ_WARN_THRESHOLD) || 200;

/** Counts Firestore reads per request and logs requests that read more than the threshold. */
export function readMeter(req: Request, res: Response, next: NextFunction): void {
  runWithReadMeter(() => {
    const store = getReadMeter();
    res.on('finish', () => {
      if (!store || store.total < WARN_THRESHOLD) return;
      const top = Object.entries(store.byCollection)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([col, n]) => `${col}=${n}`)
        .join(' ');
      console.warn(
        `[FS-READS] ${req.method} ${req.originalUrl.split('?')[0]} status=${res.statusCode} total=${store.total} ${top}`
      );
    });
    next();
  });
}
