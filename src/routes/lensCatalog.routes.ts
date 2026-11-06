import { Router } from 'express';
import {
  getCatalog,
  putSettings,
  createCoating,
  updateCoating,
  deleteCoating,
  createProduct,
  updateProduct,
  deleteProduct,
  createAddon,
  updateAddon,
  deleteAddon,
  compare,
  quote,
} from '../controllers/lensCatalog.controller';

const router = Router();

router.get('/', getCatalog);
router.post('/compare', compare);
router.post('/quote', quote);
router.put('/settings', putSettings);
router.post('/coatings', createCoating);
router.put('/coatings/:id', updateCoating);
router.delete('/coatings/:id', deleteCoating);
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.delete('/products/:id', deleteProduct);
router.post('/addons', createAddon);
router.put('/addons/:id', updateAddon);
router.delete('/addons/:id', deleteAddon);

export default router;
