import { Router, Request, Response, NextFunction } from 'express';
import { BlogPost } from '../models/BlogPost.model';

const router = Router();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

function calcReadTime(content: string): number {
  const words = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// Bulk import
router.post('/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const posts: any[] = req.body.posts;
    if (!Array.isArray(posts) || posts.length === 0) {
      res.status(400).json({ success: false, message: 'posts array required' });
      return;
    }
    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const raw of posts) {
      try {
        if (!raw.slug && raw.title) raw.slug = slugify(raw.title);
        if (!raw.readTime && raw.content) raw.readTime = calcReadTime(raw.content);
        if (raw.isPublished && !raw.publishedAt) raw.publishedAt = new Date();
        const exists = await BlogPost.exists({ slug: raw.slug });
        if (exists) { skipped++; continue; }
        await BlogPost.create(raw);
        inserted++;
      } catch (e: any) {
        errors.push(`"${raw.title || raw.slug}": ${e.message}`);
      }
    }
    res.json({ success: true, data: { inserted, skipped, errors } });
  } catch (err) {
    next(err);
  }
});

// Bulk status update (publish / unpublish)
router.patch('/bulk-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids, isPublished } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, message: 'ids array required' });
      return;
    }
    const updateFields: Record<string, unknown> = { isPublished };
    if (isPublished) {
      await BlogPost.updateMany(
        { _id: { $in: ids }, publishedAt: { $exists: false } },
        { $set: { isPublished: true, publishedAt: new Date() } }
      );
      await BlogPost.updateMany(
        { _id: { $in: ids }, publishedAt: { $exists: true } },
        { $set: { isPublished: true } }
      );
    } else {
      await BlogPost.updateMany({ _id: { $in: ids } }, { $set: updateFields });
    }
    res.json({ success: true, data: { updated: ids.length } });
  } catch (err) {
    next(err);
  }
});

// Bulk delete
router.delete('/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, message: 'ids array required' });
      return;
    }
    const result = await BlogPost.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, data: { deleted: result.deletedCount } });
  } catch (err) {
    next(err);
  }
});

// List all (admin — includes drafts)
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const posts = await BlogPost.find()
      .select('-content')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: posts });
  } catch (err) {
    next(err);
  }
});

// Get single (admin — by id)
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const post = await BlogPost.findById(req.params.id).lean();
    if (!post) { res.status(404).json({ success: false, message: 'Not found' }); return; }
    res.json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

// Create
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (!body.slug && body.title) body.slug = slugify(body.title);
    if (!body.readTime && body.content) body.readTime = calcReadTime(body.content);
    if (body.isPublished && !body.publishedAt) body.publishedAt = new Date();
    const post = await BlogPost.create(body);
    res.status(201).json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

// Update
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (body.content && !body.readTime) body.readTime = calcReadTime(body.content);
    const existing = await BlogPost.findById(req.params.id);
    if (!existing) { res.status(404).json({ success: false, message: 'Not found' }); return; }
    if (body.isPublished && !existing.publishedAt && !body.publishedAt) {
      body.publishedAt = new Date();
    }
    const post = await BlogPost.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
    res.json({ success: true, data: post });
  } catch (err) {
    next(err);
  }
});

// Delete
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const post = await BlogPost.findByIdAndDelete(req.params.id);
    if (!post) { res.status(404).json({ success: false, message: 'Not found' }); return; }
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
