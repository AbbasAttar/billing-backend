import { Schema } from 'mongoose';

export interface IWebImage {
  url: string;
  alt?: string;
  isPrimary?: boolean;
  order?: number;
}

export interface IWebSeo {
  title?: string;
  description?: string;
  keywords?: string[];
  ogImage?: string;
}

export interface IWebFields {
  isPublished: boolean;
  slug?: string;
  displayName?: string;
  shortDescription?: string;
  longDescription?: string;
  images: IWebImage[];
  tags: string[];
  gender?: 'men' | 'women' | 'unisex' | 'kids';
  shape?: string;
  color?: string;
  material?: string;
  fragranceFamily?: string[];
  longevity?: string;
  seo: IWebSeo;
  publishedAt?: Date;
  viewCount?: number;
}

const WebImageSchema = new Schema<IWebImage>(
  {
    url: { type: String, required: true, trim: true },
    alt: { type: String, trim: true, default: '' },
    isPrimary: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const WebSeoSchema = new Schema<IWebSeo>(
  {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    keywords: { type: [String], default: [] },
    ogImage: { type: String, trim: true },
  },
  { _id: false }
);

export const WebFieldsSchema = new Schema<IWebFields>(
  {
    isPublished: { type: Boolean, default: false, index: true },
    slug: { type: String, trim: true, lowercase: true, sparse: true, index: true },
    displayName: { type: String, trim: true },
    shortDescription: { type: String, trim: true },
    longDescription: { type: String, trim: true },
    images: { type: [WebImageSchema], default: [] },
    tags: { type: [String], default: [], index: true },
    gender: { type: String, enum: ['men', 'women', 'unisex', 'kids'] },
    shape: { type: String, trim: true },
    color: { type: String, trim: true },
    material: { type: String, trim: true },
    fragranceFamily: { type: [String], default: [] },
    longevity: { type: String, trim: true },
    seo: { type: WebSeoSchema, default: () => ({}) },
    publishedAt: { type: Date },
    viewCount: { type: Number, default: 0 },
  },
  { _id: false }
);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
