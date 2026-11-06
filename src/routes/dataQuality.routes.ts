import { Router } from 'express';
import {
  assignSharedBill,
  getCostQueue,
  getPhoneQueue,
  getSharedBills,
  getSummary,
  setGroupCost,
} from '../controllers/dataQuality.controller';

// Admin-only (not a staff area in middleware/accessPolicy.ts): cost prices and moving bills.
const router = Router();

router.get('/summary', getSummary);
router.get('/costs', getCostQueue);
router.post('/costs', setGroupCost);
router.get('/shared-bills', getSharedBills);
router.post('/shared-bills/:invoiceId', assignSharedBill);
router.get('/phones', getPhoneQueue);

export default router;
