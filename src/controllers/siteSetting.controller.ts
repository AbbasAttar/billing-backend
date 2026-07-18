import { Request, Response, NextFunction } from 'express';
import { SiteSetting } from '../models/SiteSetting.model';
import { invalidateInstagramCache } from '../services/instagram.service';
import { ok, fail } from '../utils/response';

const ALLOWED_KEYS = [
  'instagram_posts',
  'instagram_access_token',
  'instagram_limit',
] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];

function defaultValue(key: AllowedKey) {
  if (key === 'instagram_posts') return [];
  if (key === 'instagram_limit') return 6;
  return null;
}

export const getSetting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = req.params.key as AllowedKey;
    if (!ALLOWED_KEYS.includes(key)) {
      fail(res, 'Unknown setting key', 404);
      return;
    }
    const doc = await SiteSetting.findOne({ key }).lean();
    ok(res, doc?.value ?? defaultValue(key));
  } catch (err) {
    next(err);
  }
};

export const putSetting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = req.params.key as AllowedKey;
    if (!ALLOWED_KEYS.includes(key)) {
      fail(res, 'Unknown setting key', 404);
      return;
    }
    const { value } = req.body;
    await SiteSetting.findOneAndUpdate(
      { key },
      { $set: { value } },
      { upsert: true, new: true }
    );
    // Clear cached feed whenever token or limit changes
    if (key === 'instagram_access_token' || key === 'instagram_limit') {
      invalidateInstagramCache();
    }
    ok(res, value);
  } catch (err) {
    next(err);
  }
};
