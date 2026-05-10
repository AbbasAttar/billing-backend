import { Router } from 'express';
import { createBill, getBills, getBillById, addPayment, getAISuggestion } from '../controllers/vendorBill.controller';

const router = Router();

router.post('/', createBill);
router.get('/', getBills);
router.get('/suggestion', getAISuggestion);
router.get('/:id', getBillById);
router.patch('/:id/payment', addPayment);

export default router;
