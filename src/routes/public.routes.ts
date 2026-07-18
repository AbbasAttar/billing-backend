import { Router } from 'express';
import {
  getProducts,
  getProductBySlug,
  getCategories,
  searchPublic,
  getHomepage,
  getBlogList,
  getBlogBySlug,
  getStore,
  getInstagramPosts,
} from '../controllers/public.controller';

const router = Router();

router.get('/products', getProducts);
router.get('/products/:category/:slug', getProductBySlug);
router.get('/categories', getCategories);
router.get('/search', searchPublic);
router.get('/homepage', getHomepage);
router.get('/blog', getBlogList);
router.get('/blog/:slug', getBlogBySlug);
router.get('/store', getStore);
router.get('/instagram-posts', getInstagramPosts);

export default router;
