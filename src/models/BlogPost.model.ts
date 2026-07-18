import mongoose, { Schema, Document } from 'mongoose';

export interface IBlogPost extends Document {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: 'optical' | 'fragrance';
  tags: string[];
  readTime: number;
  isPublished: boolean;
  publishedAt?: Date;
  seo: {
    title?: string;
    description?: string;
    keywords?: string[];
  };
}

const BlogPostSchema = new Schema<IBlogPost>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    excerpt: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    category: { type: String, enum: ['optical', 'fragrance'], required: true },
    tags: [{ type: String, trim: true }],
    readTime: { type: Number, default: 5, min: 1 },
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },
    seo: {
      title: { type: String, trim: true },
      description: { type: String, trim: true },
      keywords: [{ type: String, trim: true }],
    },
  },
  { timestamps: true }
);

BlogPostSchema.index({ isPublished: 1, publishedAt: -1 });
BlogPostSchema.index({ category: 1, isPublished: 1 });

export const BlogPost = mongoose.model<IBlogPost>('BlogPost', BlogPostSchema);
