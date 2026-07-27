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
router.get('/lens-catalog', getLensCatalog);
router.get('/lens-pricing-lookup', getLensPricingLookup);
router.get('/coatings', getPublicCoatings);
router.get('/colors', getPublicColors);
router.get('/my-orders', getMyOrders);
router.get('/orders/:id', getOrderById);

export default router;
