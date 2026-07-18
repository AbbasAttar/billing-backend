import { Request, Response, NextFunction } from 'express';
import {
  listPublicProducts,
  findPublicProductBySlug,
  getCategoryTree,
  searchAll,
  getHomepageData,
  getStoreInfo,
  incrementViewCount,
  PublicProductQuery,
} from '../services/publicCatalog.service';
import { fetchInstagramFeed } from '../services/instagram.service';
import { SiteSetting } from '../models/SiteSetting.model';

function toInt(v: unknown, fallback?: number): number | undefined {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const getProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q: PublicProductQuery = {
      category: req.query.category as any,
      q: (req.query.q as string) || undefined,
      tag: (req.query.tag as string) || undefined,
      gender: (req.query.gender as string) || undefined,
      shape: (req.query.shape as string) || undefined,
      material: (req.query.material as string) || undefined,
      family: (req.query.family as string) || undefined,
      priceMin: toInt(req.query.priceMin),
      priceMax: toInt(req.query.priceMax),
      sort: (req.query.sort as any) || undefined,
      page: toInt(req.query.page, 1),
      limit: toInt(req.query.limit, 24),
    };
    const result = await listPublicProducts(q);
    res.json({ success: true, data: result.items, meta: result.meta });
  } catch (err) {
    next(err);
  }
};

export const getProductBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, slug } = req.params as { category: string; slug: string };
    const result = await findPublicProductBySlug(category, slug);
    if (!result) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }
    // fire-and-forget view count bump
    incrementViewCount(result.kind, result.product.id);

    // include long description + specs for detail view
    const { raw } = result;
    const detail = {
      ...result.product,
      longDescription: (raw as any).web?.longDescription,
      seo: (raw as any).web?.seo,
      specs: buildSpecs(raw, result.kind),
    };
    res.json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
};

function buildSpecs(raw: any, kind: 'frame' | 'lens' | 'fragrance') {
  if (kind === 'frame') {
    return {
      brand: raw.companyName,
      type: raw.type,
      shape: raw.web?.shape,
      material: raw.web?.material,
      color: raw.web?.color,
      gender: raw.web?.gender,
    };
  }
  if (kind === 'lens') {
    return {
      brand: raw.brand,
      category: raw.category,
      index: raw.index,
      coating: raw.coating,
    };
  }
  return {
    brand: raw.companyName,
    type: raw.type,
    family: raw.web?.fragranceFamily,
    longevity: raw.web?.longevity,
  };
}

export const getCategories = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tree = await getCategoryTree();
    res.json({ success: true, data: tree });
  } catch (err) {
    next(err);
  }
};

export const searchPublic = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = (req.query.q as string) || '';
    const results = await searchAll(q);
    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
};

export const getHomepage = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getHomepageData();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const getBlogList = async (_req: Request, res: Response) => {
  // Phase 1 stub — blog CMS lands in Phase 2
  res.json({ success: true, data: [], meta: { page: 1, limit: 0, total: 0 } });
};

export const getBlogBySlug = async (_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: 'Blog not found' });
};

export const getStore = async (_req: Request, res: Response) => {
  res.json({ success: true, data: getStoreInfo() });
};

export const getInstagramPosts = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [tokenDoc, limitDoc] = await Promise.all([
      SiteSetting.findOne({ key: 'instagram_access_token' }).lean(),
      SiteSetting.findOne({ key: 'instagram_limit' }).lean(),
    ]);
    const token = typeof tokenDoc?.value === 'string' ? tokenDoc.value.trim() : '';
    const limit = typeof limitDoc?.value === 'number' ? limitDoc.value : 6;

    if (!token) {
      res.json({ success: true, data: [] });
      return;
    }

    const posts = await fetchInstagramFeed(token, limit);
    res.json({ success: true, data: posts });
  } catch (err) {
    next(err);
  }
};
