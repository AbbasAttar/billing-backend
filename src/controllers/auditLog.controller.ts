import { Request, Response, NextFunction } from 'express';
import { AuditLog } from '../models/AuditLog.model';
import { paginate } from '../services/dataQuality';
import { categoryOf, rebuildDisplay } from '../services/auditTrail';
import { staffNameFor } from '../middleware/auth';

const DAY = 86_400_000;

/**
 * GET /audit-log?days=7&email=&category=&area=&flagged=1&q=&page=1 — writes made through the admin app,
 * newest first. `flagged` keeps entries that need a look (high discount, free bill, deletes,
 * payment edits, write-offs, failures). Also returns who and which areas appear in the window,
 * for the filters.
 */
export const getAuditLog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = Math.min(Math.max(parseInt(String(req.query.days)) || 7, 1), 365);
    const since = new Date(Date.now() - days * DAY);
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    const area = typeof req.query.area === 'string' ? req.query.area : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const flagged = req.query.flagged === '1' || req.query.flagged === 'true';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

    const all = ((await AuditLog.find({ at: { $gte: since } }).lean()) as any[])
      // Entries written before categories existed get theirs from the path.
      // Entries written before categories / staff names existed get them on read (nothing is rewritten).
      .map((e) => ({ ...e, _id: String(e._id ?? e.id), at: new Date(e.at), category: e.category ?? categoryOf(e.path ?? ''), name: e.name ?? staffNameFor(e.email) }))
      .sort((a, b) => b.at.getTime() - a.at.getTime());

    // Staff filter: email + the latest name seen for it.
    const userMap = new Map<string, string | undefined>();
    for (const e of all) {
      const key = e.email || 'not signed in';
      if (!userMap.has(key) || (!userMap.get(key) && e.name)) userMap.set(key, e.name);
    }
    const users = [...userMap].map(([email, name]) => ({ email, ...(name ? { name } : {}) })).sort((a, b) => a.email.localeCompare(b.email));
    const areas = [...new Set(all.map((e) => e.area).filter(Boolean))].sort();
    const flagCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    for (const e of all) {
      for (const f of e.flags ?? []) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
      categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
    }

    const list = all.filter(
      (e) =>
        (!email || (e.email || 'not signed in') === email) &&
        (!area || e.area === area) &&
        (!category || e.category === category) &&
        (!flagged || (e.flags ?? []).length > 0) &&
        (!q || `${e.summary} ${e.name ?? ''} ${e.email ?? ''} ${e.path} ${e.targetId ?? ''}`.toLowerCase().includes(q)),
    );
    const { page, pages, limit, slice } = paginate(list, req.query.page, req.query.limit, 50);
    res.json({
      days,
      total: list.length,
      page,
      pages,
      limit,
      users,
      areas,
      flagCounts,
      categoryCounts,
      // Entries from older versions of the log get today's card fields, rebuilt on read.
      entries: slice.map(({ expireAt: _x, id: _id2, ...e }) => {
        if (e.primary && e.figures) return e;
        const rebuilt = rebuildDisplay(e);
        return rebuilt ? { ...e, ...rebuilt, summary: e.summary } : e;
      }),
    });
  } catch (error) {
    next(error);
  }
};
