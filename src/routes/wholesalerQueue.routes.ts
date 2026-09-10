import { Router } from 'express';
import {
  getPendingOrderItems,
  markSentToWholesaler,
  getDailyWholesalerSummary,
  updateLabOrderStatus,
  updateLabOrderItem,
  createDirectLabOrder,
  deleteLabOrder,
} from '../controllers/wholesalerQueue.controller';

const router = Router();

// GET  /api/wholesaler-queue        — all items with status & customer context
router.get('/', getPendingOrderItems);

// GET  /api/wholesaler-queue/summary — daily 7:00-7:30 PM summary
router.get('/summary', getDailyWholesalerSummary);

// POST /api/wholesaler-queue/direct-order — log direct customer lab order without invoice
router.post('/direct-order', createDirectLabOrder);

// POST /api/wholesaler-queue/send   — body: { ids: string[] }
router.post('/send', markSentToWholesaler);

// PATCH /api/wholesaler-queue/status — body: { ids: string[], status: string }
router.patch('/status', updateLabOrderStatus);

// PATCH /api/wholesaler-queue/item/:id — update lens details for an order
router.patch('/item/:id', updateLabOrderItem);

// DELETE /api/wholesaler-queue/:id or DELETE /api/wholesaler-queue — delete/cancel orders
router.delete('/:id', deleteLabOrder);
router.delete('/', deleteLabOrder);

export default router;


