import { Request, Response, NextFunction } from 'express';
import { SiteSetting } from '../models/SiteSetting.model';

/** Shop-wide lists used by the fragrance form: attar grade names and the shared notes library. */
const KEYS = { grades: 'fragrance_grades', notes: 'fragrance_notes' } as const;

/** Trimmed, de-duplicated (case-insensitive), in the order given. */
export function cleanList(value: unknown, max = 300): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const t = v.trim().replace(/\s+/g, ' ');
    if (!t || t.length > 60 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

async function read(key: string): Promise<string[]> {
  const doc: any = await SiteSetting.findOne({ key }).lean();
  return cleanList(doc?.value);
}

/** GET /fragrances/presets → { grades, notes } */
export const getFragrancePresets = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [grades, notes] = await Promise.all([read(KEYS.grades), read(KEYS.notes)]);
    res.json({ grades, notes });
  } catch (e) {
    next(e);
  }
};

/** PUT /fragrances/presets { grades?, notes? } — replaces the lists that are sent. */
export const updateFragrancePresets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    for (const k of ['grades', 'notes'] as const) {
      if (req.body?.[k] === undefined) continue;
      await SiteSetting.findOneAndUpdate({ key: KEYS[k] }, { $set: { value: cleanList(req.body[k]) } }, { upsert: true, new: true });
    }
    const [grades, notes] = await Promise.all([read(KEYS.grades), read(KEYS.notes)]);
    res.json({ grades, notes });
  } catch (e) {
    next(e);
  }
};
