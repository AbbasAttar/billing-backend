import { Router } from 'express';
import {
  getWholesaleItems,
  createWholesaleItem,
  updateWholesaleItem,
  adjustWholesaleStock,
  archiveWholesaleItem,
  setWholesaleOrderStatus,
  updateOrderQueue,
} from '../controllers/wholesaleItem.controller';
import {
  getWholesaleCompanies,
  createWholesaleCompany,
  updateWholesaleCompany,
  deleteWholesaleCompany,
} from '../controllers/wholesaleCompany.controller';

const router = Router();

// Company master list (before /:id routes).
router.get('/companies', getWholesaleCompanies);
router.post('/companies', createWholesaleCompany);
router.put('/companies/:id', updateWholesaleCompany);
router.delete('/companies/:id', deleteWholesaleCompany);

router.post('/order-status', setWholesaleOrderStatus);
router.post('/queue', updateOrderQueue);

router.get('/', getWholesaleItems);
router.post('/', createWholesaleItem);
router.put('/:id', updateWholesaleItem);
router.post('/:id/adjust-stock', adjustWholesaleStock);
router.patch('/:id/archive', archiveWholesaleItem);

export default router;
