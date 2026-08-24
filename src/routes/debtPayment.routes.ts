import { Router } from 'express';
import { listPayments, createPayment, deletePayment } from '../controllers/debtPayment.controller';

const router = Router();

router.get('/', listPayments);
router.post('/', createPayment);
router.delete('/:id', deletePayment);

export default router;
