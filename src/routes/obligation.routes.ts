import { Router } from 'express';
import { listObligations, createObligation, updateObligation, deleteObligation, recordPayment } from '../controllers/obligation.controller';

const router = Router();

router.get('/', listObligations);
router.post('/', createObligation);
router.put('/:id', updateObligation);
router.delete('/:id', deleteObligation);
router.post('/:id/payment', recordPayment);

export default router;
