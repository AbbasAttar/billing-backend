import { Router } from 'express';
import { getBillFeedbackSummary, resolveBillFeedback } from '../controllers/billFeedback.controller';

const router = Router();

router.get('/', getBillFeedbackSummary);
router.patch('/:id/resolve', resolveBillFeedback);

export default router;
