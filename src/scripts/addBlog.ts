import mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { connectDB } from '../config/database';
import { BlogPost } from '../models/BlogPost.model';

interface BlogInput {
  slug: string;
  title: string;
  excerpt: string;
  category: 'optical' | 'fragrance';
  tags: string[];
  publishedAt?: string; // ISO date string, defaults to today
  seo: {
    title: string;
    description: string;
    keywords: string[];
  };
  content: string; // HTML string
}

function estimateReadTime(htmlContent: string): number {
  const text = htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = text.split(' ').length;
  return Math.max(1, Math.round(wordCount / 200));
}

async function addBlog() {
  const inputPath = process.argv[2] || path.join(__dirname, 'blog-input.json');

  if (!fs.existsSync(inputPath)) {
    console.error(`❌  Input file not found: ${inputPath}`);
    console.error(`   Create blog-input.json in src/scripts/ or pass a path as argument.`);
    process.exit(1);
  }

  let input: BlogInput;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  } catch (err: any) {
    console.error(`❌  Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }

  const required = ['slug', 'title', 'excerpt', 'category', 'tags', 'seo', 'content'] as const;
  for (const field of required) {
    if (!input[field]) {
      console.error(`❌  Missing required field: "${field}"`);
      process.exit(1);
    }
  }

  if (!['optical', 'fragrance'].includes(input.category)) {
    console.error(`❌  category must be "optical" or "fragrance"`);
    process.exit(1);
  }

  await connectDB();

  const exists = await BlogPost.exists({ slug: input.slug });
  if (exists) {
    console.log(`⚠️   Blog already exists with slug "${input.slug}" — skipping.`);
    await mongoose.disconnect();
    return;
  }

  const post = await BlogPost.create({
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    category: input.category,
    tags: input.tags,
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : new Date(),
    readTime: estimateReadTime(input.content),
    isPublished: true,
    seo: input.seo,
    content: input.content,
  });

  console.log(`✅  Blog published successfully!`);
  console.log(`   Title    : ${post.title}`);
  console.log(`   Slug     : ${post.slug}`);
  console.log(`   Category : ${post.category}`);
  console.log(`   Read time: ${post.readTime} min`);
  console.log(`   Tags     : ${post.tags.join(', ')}`);

  await mongoose.disconnect();
}

addBlog().catch((err) => {
  console.error(err);
  process.exit(1);
});
