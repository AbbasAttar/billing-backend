import { Frame, IFrame } from '../models/Frame.model';
import { Fragrance, IFragrance } from '../models/Fragrance.model';
import { OpticalLens, IOpticalLens } from '../models/OpticalLens.model';

export type PublicCategory =
  | 'frames'
  | 'sunglasses'
  | 'contact-lenses'
  | 'lenses'
  | 'attars'
  | 'perfumes'
  | 'bakhoor';

export interface PublicProductQuery {
  category?: PublicCategory | 'optical' | 'fragrance' | 'all';
  q?: string;
  tag?: string;
  gender?: string;
  shape?: string;
  material?: string;
  family?: string;
  longevity?: string;
  priceMin?: number;
  priceMax?: number;
  sort?: 'newest' | 'popular' | 'price_asc' | 'price_desc' | 'alphabetical';
  page?: number;
  limit?: number;
}

export interface PublicProductVariant {
  label: string;
  sellPrice: number;
  stock: number;
}

export interface PublicProductAtarSize {
  label: string;
  price: number;
}

export interface PublicProduct {
  id: string;
  category: 'frames' | 'lenses' | 'fragrances';
  subCategory?: string;
  slug: string;
  name: string;
  brand: string;
  price: number;
  images: { url: string; alt?: string; isPrimary?: boolean }[];
  primaryImage?: string;
  shortDescription?: string;
  tags: string[];
  gender?: string;
  shape?: string;
  material?: string;
  color?: string;
  longDescription?: string;
  fragranceFamily?: string[];
  variants?: PublicProductVariant[];
  atarSizes?: PublicProductAtarSize[];
  frameSize?: { lensWidth?: number; bridgeWidth?: number; templeLength?: number };
  colorVariants?: { color: string; slug: string }[];
  createdAt: Date;
  publishedAt?: Date;
}

const PUBLIC_FIELDS = {
  costPrice: 0,
  __v: 0,
};

function frameToPublic(f: IFrame): PublicProduct {
  const web = f.web ?? ({} as any);
  const primary = web.images?.find((i: any) => i.isPrimary) ?? web.images?.[0];
  return {
    id: (f._id as any).toString(),
    category: 'frames',
    subCategory: f.type ?? undefined,
    slug: web.slug ?? '',
    name: web.displayName || f.name,
    brand: f.companyName,
    price: f.sellPrice ?? 0,
    images: web.images ?? [],
    primaryImage: primary?.url,
    shortDescription: web.shortDescription,
    tags: web.tags ?? [],
    gender: web.gender,
    shape: web.shape,
    material: web.material,
    color: web.color,
    longDescription: web.longDescription,
    frameSize: web.frameSize,
    colorVariants: web.colorVariants,
    createdAt: (f as any).createdAt,
    publishedAt: web.publishedAt,
  };
}

function fragranceToPublic(f: IFragrance): PublicProduct {
  const web = f.web ?? ({} as any);
  const primary = web.images?.find((i: any) => i.isPrimary) ?? web.images?.[0];
  const variants: PublicProductVariant[] | undefined =
    f.variants && f.variants.length > 0
      ? f.variants.map((v) => ({ label: v.label, sellPrice: v.sellPrice, stock: v.stock }))
      : undefined;
  return {
    id: (f._id as any).toString(),
    category: 'fragrances',
    subCategory: f.type,
    slug: web.slug ?? '',
    name: web.displayName || f.name,
    brand: f.companyName,
    price: f.sellPrice ?? 0,
    images: web.images ?? [],
    primaryImage: primary?.url,
    shortDescription: web.shortDescription,
    tags: web.tags ?? [],
    fragranceFamily: web.fragranceFamily,
    variants,
    atarSizes: web.atarSizes?.length ? web.atarSizes.map((s: any) => ({ label: s.label, price: s.price })) : undefined,
    createdAt: (f as any).createdAt,
    publishedAt: web.publishedAt,
  };
}

function lensToPublic(l: IOpticalLens): PublicProduct {
  const web = l.web ?? ({} as any);
  const primary = web.images?.find((i: any) => i.isPrimary) ?? web.images?.[0];
  return {
    id: (l._id as any).toString(),
    category: 'lenses',
    subCategory: l.category,
    slug: web.slug ?? '',
    name: web.displayName || l.name,
    brand: l.brand,
    price: l.sellPrice ?? 0,
    images: web.images ?? [],
    primaryImage: primary?.url,
    shortDescription: web.shortDescription,
    tags: web.tags ?? [],
    createdAt: (l as any).createdAt,
    publishedAt: web.publishedAt,
  };
}

function baseFilter(query: PublicProductQuery, isFragrance = false) {
  const filter: any = { 'web.isPublished': true };
  if (query.tag) filter['web.tags'] = query.tag;
  if (query.gender) filter['web.gender'] = query.gender;
  if (query.shape) filter['web.shape'] = query.shape;
  if (query.material) filter['web.material'] = query.material;
  if (query.family && isFragrance) filter['web.fragranceFamily'] = query.family;
  if (query.longevity && isFragrance) filter['web.longevity'] = query.longevity;
  if (query.priceMin != null || query.priceMax != null) {
    filter.sellPrice = {};
    if (query.priceMin != null) filter.sellPrice.$gte = query.priceMin;
    if (query.priceMax != null) filter.sellPrice.$lte = query.priceMax;
  }
  if (query.q) {
    const words = query.q.trim().split(/\s+/).filter(Boolean);
    const fieldMatchers = (word: string) => {
      const rx = new RegExp(escapeRegex(word), 'i');
      return [
        { name: rx },
        { companyName: rx },
        { brand: rx },
        { 'web.displayName': rx },
        { 'web.shortDescription': rx },
        { 'web.tags': rx },
      ];
    };
    filter.$or = words.flatMap(fieldMatchers);
  }
  return filter;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortSpec(sort?: PublicProductQuery['sort']): Record<string, 1 | -1> {
  switch (sort) {
    case 'price_asc':
      return { sellPrice: 1 };
    case 'price_desc':
      return { sellPrice: -1 };
    case 'popular':
      return { 'web.viewCount': -1, 'web.publishedAt': -1 };
    case 'alphabetical':
      return { name: 1 };
    case 'newest':
    default:
      return { 'web.publishedAt': -1, createdAt: -1 };
  }
}

export async function listPublicProducts(query: PublicProductQuery) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(60, Math.max(1, query.limit ?? 24));
  const skip = (page - 1) * limit;
  const sort = sortSpec(query.sort);

  const cat = query.category ?? 'all';
  const results: PublicProduct[] = [];
  let total = 0;

  const wantFrames = cat === 'all' || cat === 'optical' || cat === 'frames' || cat === 'sunglasses';
  const wantLenses = cat === 'all' || cat === 'optical' || cat === 'contact-lenses' || cat === 'lenses';
  const wantFragrances = cat === 'all' || cat === 'fragrance' || cat === 'attars' || cat === 'perfumes' || cat === 'bakhoor';

  if (wantFrames) {
    const filter = baseFilter(query);
    if (cat === 'sunglasses') filter.type = /sunglass/i;
    if (cat === 'frames') filter.type = { $not: /sunglass/i };
    const [items, count] = await Promise.all([
      Frame.find(filter, PUBLIC_FIELDS).sort(sort).skip(skip).limit(limit).lean<IFrame[]>(),
      Frame.countDocuments(filter),
    ]);
    results.push(...items.map(frameToPublic));
    total += count;
  }

  if (wantLenses) {
    const filter = baseFilter(query);
    const [items, count] = await Promise.all([
      OpticalLens.find(filter, PUBLIC_FIELDS).sort(sort).skip(skip).limit(limit).lean<IOpticalLens[]>(),
      OpticalLens.countDocuments(filter),
    ]);
    results.push(...items.map(lensToPublic));
    total += count;
  }

  if (wantFragrances) {
    const filter = baseFilter(query, true);
    if (cat === 'attars') filter.type = 'attar';
    if (cat === 'perfumes') filter.type = 'perfume';
    if (cat === 'bakhoor') filter.type = 'bakhoor';
    const [items, count] = await Promise.all([
      Fragrance.find(filter, PUBLIC_FIELDS).sort(sort).skip(skip).limit(limit).lean<IFragrance[]>(),
      Fragrance.countDocuments(filter),
    ]);
    results.push(...items.map(fragranceToPublic));
    total += count;
  }

  return {
    items: results,
    meta: { page, limit, total, hasMore: skip + results.length < total },
  };
}

export async function findPublicProductBySlug(category: string, slug: string) {
  const filter = { 'web.slug': slug, 'web.isPublished': true };
  const opticalCats = ['frames', 'sunglasses', 'optical'];
  const lensCats = ['lenses', 'contact-lenses'];
  const fragranceCats = ['fragrances', 'attars', 'perfumes', 'bakhoor'];

  if (opticalCats.includes(category)) {
    const item = await Frame.findOne(filter, PUBLIC_FIELDS).lean<IFrame>();
    if (item) return { product: frameToPublic(item), raw: item, kind: 'frame' as const };
  }
  if (lensCats.includes(category)) {
    const item = await OpticalLens.findOne(filter, PUBLIC_FIELDS).lean<IOpticalLens>();
    if (item) return { product: lensToPublic(item), raw: item, kind: 'lens' as const };
  }
  if (fragranceCats.includes(category)) {
    const item = await Fragrance.findOne(filter, PUBLIC_FIELDS).lean<IFragrance>();
    if (item) return { product: fragranceToPublic(item), raw: item, kind: 'fragrance' as const };
  }
  return null;
}

export async function searchAll(q: string) {
  if (!q?.trim()) return { products: [] as PublicProduct[] };
  const query: PublicProductQuery = { q, limit: 20 };
  const { items } = await listPublicProducts(query);
  return { products: items };
}

export async function getCategoryTree() {
  const [
    framesCount,
    sunglassesCount,
    lensesCount,
    attarsCount,
    perfumesCount,
    bakhoorCount,
  ] = await Promise.all([
    Frame.countDocuments({ 'web.isPublished': true, type: { $not: /sunglass/i } }),
    Frame.countDocuments({ 'web.isPublished': true, type: /sunglass/i }),
    OpticalLens.countDocuments({ 'web.isPublished': true }),
    Fragrance.countDocuments({ 'web.isPublished': true, type: 'attar' }),
    Fragrance.countDocuments({ 'web.isPublished': true, type: 'perfume' }),
    Fragrance.countDocuments({ 'web.isPublished': true, type: 'bakhoor' }),
  ]);
  return {
    optical: {
      label: 'Optical',
      slug: 'optical',
      children: [
        { label: 'Frames', slug: 'frames', count: framesCount },
        { label: 'Sunglasses', slug: 'sunglasses', count: sunglassesCount },
        { label: 'Contact Lenses', slug: 'contact-lenses', count: lensesCount },
      ],
    },
    fragrance: {
      label: 'Fragrance',
      slug: 'fragrance',
      children: [
        { label: 'Attars', slug: 'attars', count: attarsCount },
        { label: 'Perfumes', slug: 'perfumes', count: perfumesCount },
        { label: 'Bakhoor', slug: 'bakhoor', count: bakhoorCount },
      ],
    },
  };
}

export async function getHomepageData() {
  const [bestSellers, newArrivals, premium] = await Promise.all([
    listPublicProducts({ tag: 'best-seller', limit: 8, sort: 'popular' }),
    listPublicProducts({ limit: 8, sort: 'newest' }),
    listPublicProducts({ tag: 'premium', limit: 8, sort: 'popular' }),
  ]);
  return {
    bestSellers: bestSellers.items,
    newArrivals: newArrivals.items,
    premium: premium.items,
  };
}

export function getStoreInfo() {
  return {
    name: process.env.STORE_NAME || 'Attarwala Optical House',
    tagline: process.env.STORE_TAGLINE || 'Premium Eyewear & Fragrances',
    address: {
      line1: process.env.STORE_ADDRESS_LINE1 || 'Nagar Palika Complex Shop No. 1, Opp. Dr. S M Jain Hospital',
      city: process.env.STORE_CITY || 'Dahod',
      state: process.env.STORE_STATE || 'Gujarat',
      country: process.env.STORE_COUNTRY || 'India',
      pincode: process.env.STORE_PINCODE || '389151',
    },
    phone: process.env.STORE_PHONE || '+91 7041910053',
    whatsapp: process.env.STORE_WHATSAPP || process.env.STORE_PHONE || '+91 7041910053',
    email: process.env.STORE_EMAIL || 'contact@attarwalaopticalhouse.com',
    instagram: process.env.STORE_INSTAGRAM_URL || 'https://instagram.com/attarwalaopticalhouse',
    hours: [
      {
        day: 'Mon-Sat',
        open: process.env.STORE_HOURS_WEEKDAY_OPEN || '10:00',
        close: process.env.STORE_HOURS_WEEKDAY_CLOSE || '21:00',
      },
      {
        day: 'Sun',
        open: process.env.STORE_HOURS_SUNDAY_OPEN || '11:00',
        close: process.env.STORE_HOURS_SUNDAY_CLOSE || '20:00',
      },
    ],
    mapEmbedUrl:
      process.env.STORE_MAP_EMBED_URL ||
      'https://maps.google.com/maps?q=Nagar+Palika+Complex+Dahod+Gujarat&t=&z=15&ie=UTF8&iwloc=&output=embed',
    lat: parseFloat(process.env.STORE_LAT || '22.8378'),
    lng: parseFloat(process.env.STORE_LNG || '74.2597'),
  };
}

export async function incrementViewCount(kind: 'frame' | 'lens' | 'fragrance', id: string) {
  try {
    if (kind === 'frame') {
      await Frame.updateOne({ _id: id }, { $inc: { 'web.viewCount': 1 } });
    } else if (kind === 'lens') {
      await OpticalLens.updateOne({ _id: id }, { $inc: { 'web.viewCount': 1 } });
    } else {
      await Fragrance.updateOne({ _id: id }, { $inc: { 'web.viewCount': 1 } });
    }
  } catch {
    // fire-and-forget
  }
}
