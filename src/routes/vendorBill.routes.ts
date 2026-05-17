import { Router } from 'express';
import { createBill, getBills, getBillById, addPayment, getAISuggestion, updateBill, deleteBill } from '../controllers/vendorBill.controller';

const router = Router();

router.post('/', createBill);
router.get('/', getBills);
router.get('/suggestion', getAISuggestion);
router.get('/:id', getBillById);
router.put('/:id', updateBill);
router.delete('/:id', deleteBill);
router.patch('/:id/payment', addPayment);

export default router;
