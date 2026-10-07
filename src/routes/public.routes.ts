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
  getLensCatalog,
  getLensPricingLookup,
  getPublicCoatings,
  getPublicColors,
  getMyOrders,
  getOrderById,
  getMyInvoices,
  getInvoiceById,
} from '../controllers/public.controller';

import { publicCache, publicRateLimit } from '../middleware/publicCache';

const router = Router();

router.use(publicRateLimit);

// Catalog endpoints are identical for every visitor, so the CDN may cache them.
router.get('/products', publicCache(300, 600), getProducts);
router.get('/products/:category/:slug', publicCache(300, 600), getProductBySlug);
router.get('/categories', publicCache(3600, 7200), getCategories);
router.get('/search', publicCache(60, 300), searchPublic);
router.get('/homepage', publicCache(300, 600), getHomepage);
router.get('/blog', publicCache(300, 600), getBlogList);
router.get('/blog/:slug', publicCache(300, 600), getBlogBySlug);
router.get('/store', publicCache(3600, 7200), getStore);
router.get('/instagram-posts', publicCache(300, 600), getInstagramPosts);
router.get('/lens-catalog', publicCache(300, 600), getLensCatalog);
router.get('/lens-pricing-lookup', publicCache(300, 600), getLensPricingLookup);
router.get('/coatings', publicCache(3600, 7200), getPublicCoatings);
router.get('/colors', publicCache(3600, 7200), getPublicColors);

// Per-user data: never cached.
router.get('/my-orders', getMyOrders);
router.get('/my-invoices', getMyInvoices);
router.get('/orders/:id', getOrderById);
router.get('/invoices/:id', getInvoiceById);

export default router;
