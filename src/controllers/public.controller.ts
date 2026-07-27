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
import { BlogPost } from '../models/BlogPost.model';
import { OpticalLens } from '../models/OpticalLens.model';
import { LensPricing } from '../models/LensPricing.model';
import { Coating } from '../models/Coating.model';
import { Order } from '../models/Order.model';
import { Fragrance } from '../models/Fragrance.model';
import { Frame } from '../models/Frame.model';
import { FrameColor } from '../models/FrameColor.model';

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
      color: (req.query.color as string) || undefined,
      family: (req.query.family as string) || undefined,
      longevity: (req.query.longevity as string) || undefined,
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
      colors: result.product.colors,
      frameVariants: result.product.frameVariants,
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
    // contact lens (has lensType) vs optical lens (has category/index)
    if (raw.lensType) {
      return {
        brand: raw.brand,
        lensType: raw.lensType,
        packSize: raw.packSize,
        baseCurve: raw.baseCurve,
        diameter: raw.diameter,
        color: raw.web?.color,
      };
    }
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

export const getBlogList = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter: any = { isPublished: true };
    const cat = req.query.category as string | undefined;
    if (cat && ['optical', 'fragrance'].includes(cat)) filter.category = cat;
    const posts = await BlogPost.find(filter)
      .select('-content')
      .sort({ publishedAt: -1 })
      .lean();
    res.json({ success: true, data: posts, meta: { total: posts.length } });
  } catch (err) {
    next(err);
  }
};

export const getBlogBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const post = await BlogPost.findOne({ slug: req.params.slug, isPublished: true }).lean();
    if (!post) { res.status(404).json({ success: false, message: 'Blog post not found' }); return; }
    res.json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
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

export const getLensCatalog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter: any = {};
    if (req.query.category) filter.category = req.query.category as string;
    const lenses = await OpticalLens.find(filter, { costPrice: 0, web: 0, __v: 0 })
      .sort({ category: 1, index: 1, brand: 1, name: 1 })
      .lean();
    res.json({ success: true, data: lenses });
  } catch (err) {
    next(err);
  }
};

export const getLensPricingLookup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { lensType, material, coating, color, axisType = 'any', sph: qSph, cyl: qCyl, add: qAdd } =
      req.query as Record<string, string | undefined>;

    const sph = parseFloat(qSph ?? '');
    const cyl = parseFloat(qCyl ?? '');
    if (isNaN(sph) || isNaN(cyl)) {
      res.json({ success: true, data: null });
      return;
    }

    const hasAdd = qAdd !== undefined && qAdd !== '' && qAdd !== 'null';
    const addVal = hasAdd ? parseFloat(qAdd as string) : null;

    const baseQuery: Record<string, unknown> = {
      lensType, material, coating, color,
      axisType: { $in: [axisType, 'any'] },
      minSph: { $lte: sph },
      maxSph: { $gte: sph },
      minCyl: { $lte: cyl },
      maxCyl: { $gte: cyl },
    };

    if (addVal === null) {
      baseQuery.minAdd = null;
    } else {
      baseQuery.$and = [
        { minAdd: { $ne: null } },
        { minAdd: { $lte: addVal } },
        { $or: [{ maxAdd: null }, { maxAdd: { $gte: addVal } }] },
      ];
    }

    const [entry] = await LensPricing.aggregate([
      { $match: baseQuery },
      {
        $addFields: {
          _axisScore: { $cond: [{ $eq: ['$axisType', 'any'] }, 1, 0] },
          _sphRange:  { $subtract: ['$maxSph', '$minSph'] },
          _cylRange:  { $subtract: ['$maxCyl', '$minCyl'] },
        },
      },
      { $sort: { _axisScore: 1, _sphRange: 1, _cylRange: 1 } },
      { $limit: 1 },
      { $project: { _axisScore: 0, _sphRange: 0, _cylRange: 0, costPrice: 0 } },
    ]);

    res.json({ success: true, data: entry ?? null });
  } catch (err) {
    next(err);
  }
};

export const getPublicCoatings = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const coatings = await Coating.find({}, { name: 1, _id: 0 }).sort({ name: 1 }).lean();
    res.json({ success: true, data: coatings.map((c) => c.name) });
  } catch (err) {
    next(err);
  }
};

export const getPublicColors = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const colors = await FrameColor.find({}, { name: 1, hex: 1 }).sort({ name: 1 }).lean();
    res.json({ success: true, data: colors });
  } catch (err) {
    next(err);
  }
};

export const getMyOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = (req.query.email as string | undefined)?.toLowerCase().trim();
    const phone = (req.query.phone as string | undefined)?.trim();

    if (!email && !phone) {
      res.status(400).json({ success: false, message: 'email or phone required' });
      return;
    }

    const filter: Record<string, unknown> = {};
    if (email) filter.customerEmail = { $regex: new RegExp(`^${email}$`, 'i') };
    else if (phone) filter.customerPhone = phone;

    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(50).lean();

    // Collect lookup keys for items missing images
    const productIds: string[] = [];
    const slugs: string[] = [];
    const names: string[] = [];

    for (const order of orders) {
      for (const item of order.items as any[]) {
        if (item.image) continue;
        if (item.productId) productIds.push(item.productId);
        else if (item.slug) slugs.push(item.slug);
        else if (item.name) {
          // Strip variant suffix like " (3ml)", " (100ml)", " (Large)" etc.
          const base = item.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
          if (base) names.push(base);
        }
      }
    }

    const imageMap = new Map<string, string>(); // key → image URL
    const imgProjection = { 'web.images': 1, 'web.slug': 1, name: 1, 'web.displayName': 1 };

    function extractPrimary(p: any, key: string) {
      if (!key) return;
      const imgs: any[] = p.web?.images ?? [];
      const url = (imgs.find((i: any) => i.isPrimary) ?? imgs[0])?.url;
      if (url) imageMap.set(key, url);
    }

    if (productIds.length > 0) {
      const [fs, fr, ls] = await Promise.all([
        Fragrance.find({ _id: { $in: productIds } }, imgProjection).lean(),
        Frame.find({ _id: { $in: productIds } }, imgProjection).lean(),
        OpticalLens.find({ _id: { $in: productIds } }, imgProjection).lean(),
      ]);
      for (const p of [...fs, ...fr, ...ls]) extractPrimary(p, (p._id as any).toString());
    }

    if (slugs.length > 0) {
      const [fs, fr, ls] = await Promise.all([
        Fragrance.find({ 'web.slug': { $in: slugs } }, imgProjection).lean(),
        Frame.find({ 'web.slug': { $in: slugs } }, imgProjection).lean(),
        OpticalLens.find({ 'web.slug': { $in: slugs } }, imgProjection).lean(),
      ]);
      for (const p of [...fs, ...fr, ...ls]) extractPrimary(p, (p as any).web?.slug);
    }

    if (names.length > 0) {
      const nameRegexes = names.map(n => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'));
      const nameFilter = { $or: [{ name: { $in: nameRegexes } }, { 'web.displayName': { $in: nameRegexes } }] };
      const [fs, fr, ls] = await Promise.all([
        Fragrance.find(nameFilter, imgProjection).lean(),
        Frame.find(nameFilter, imgProjection).lean(),
        OpticalLens.find(nameFilter, imgProjection).lean(),
      ]);
      for (const p of [...fs, ...fr, ...ls]) {
        const pName: string = (p as any).web?.displayName || (p as any).name || '';
        // Map every queried name that this product's name starts with
        for (const n of names) {
          if (pName.toLowerCase().startsWith(n.toLowerCase())) extractPrimary(p, n);
        }
      }
    }

    const enriched = orders.map(order => ({
      ...order,
      items: (order.items as any[]).map(item => {
        if (item.image) return item;
        const base = item.name ? item.name.replace(/\s*\([^)]*\)\s*$/, '').trim() : '';
        return {
          ...item,
          image: imageMap.get(item.productId) || imageMap.get(item.slug) || imageMap.get(base) || undefined,
        };
      }),
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
};

export const getOrderById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).lean();
    if (!order) { res.status(404).json({ success: false, message: 'Order not found' }); return; }
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};
