import { Router } from 'express';
import { listPayments, deletePayment } from '../controllers/obligationPayment.controller';

const router = Router();

router.get('/', listPayments);
router.delete('/:id', deletePayment);

export default router;
