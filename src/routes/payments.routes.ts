import { Router } from 'express';
import { getGivenPayments, getPendingPayments } from '../controllers/payments.controller';

const router = Router();

router.get('/pending', getPendingPayments);
router.get('/given', getGivenPayments);

export default router;
