import { Router } from 'express';
import { getPendingOrderItems, markSentToWholesaler } from '../controllers/wholesalerQueue.controller';

const router = Router();

// GET  /api/wholesaler-queue        — all unsent ordered items with invoice/customer context
router.get('/', getPendingOrderItems);

// POST /api/wholesaler-queue/send   — body: { ids: string[] }
router.post('/send', markSentToWholesaler);

export default router;
