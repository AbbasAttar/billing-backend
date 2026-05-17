import { Router } from 'express';
import {
  getAllOpticalNumbers,
  getByCustomer,
  getOpticalNumberById,
  createOpticalNumber,
  updateOpticalNumber,
  deleteOpticalNumber,
} from '../controllers/opticalNumber.controller';

const router = Router();

router.get('/customer/:customerId', getByCustomer);
router.get('/', getAllOpticalNumbers);
router.get('/:id', getOpticalNumberById);
router.post('/', createOpticalNumber);
router.put('/:id', updateOpticalNumber);
router.delete('/:id', deleteOpticalNumber);

export default router;
