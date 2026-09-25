import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IBlogPost extends BaseDoc {
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
  createdAt?: Date;
  updatedAt?: Date;
}

export const BlogPost = createFirestoreModel<IBlogPost>('blogposts');
