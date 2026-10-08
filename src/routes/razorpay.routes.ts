import { Router } from 'express';
import {
  createOrder, verifyPayment, listOrders, updateOrderStatus,
  setLensPrice, createBalanceOrder, verifyBalancePayment, deleteOrder,
} from '../controllers/razorpay.controller';
import { requireAdmin, attachCustomer } from '../middleware/auth';

const router = Router();

// The webhook is mounted in app.ts before express.json(), because it needs the raw body.

// Storefront (customer) endpoints
router.post('/create-order', attachCustomer, createOrder);
router.post('/verify-payment', verifyPayment);
router.post('/orders/:id/create-balance-order', attachCustomer, createBalanceOrder);
router.post('/verify-balance-payment', verifyBalancePayment);

// Admin endpoints
router.get('/orders', requireAdmin, listOrders);
router.patch('/orders/:id/status', requireAdmin, updateOrderStatus);
router.delete('/orders/:id', requireAdmin, deleteOrder);
router.patch('/orders/:id/set-lens-price', requireAdmin, setLensPrice);

export default router;
