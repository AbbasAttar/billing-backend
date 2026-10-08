import { Router } from 'express';
import {
  createOrder, verifyPayment, listOrders, updateOrderStatus,
  setLensPrice, createBalanceOrder, verifyBalancePayment, deleteOrder,
} from '../controllers/razorpay.controller';
import { requireAdmin, requireStaff, attachCustomer } from '../middleware/auth';

const router = Router();

// The webhook is mounted in app.ts before express.json(), because it needs the raw body.

// Storefront (customer) endpoints
router.post('/create-order', attachCustomer, createOrder);
router.post('/verify-payment', verifyPayment);
router.post('/orders/:id/create-balance-order', attachCustomer, createBalanceOrder);
router.post('/verify-balance-payment', verifyBalancePayment);

// Admin-app endpoints: staff handle dispatch and lens quotes; only admins delete orders
router.get('/orders', requireStaff, listOrders);
router.patch('/orders/:id/status', requireStaff, updateOrderStatus);
router.delete('/orders/:id', requireAdmin, deleteOrder);
router.patch('/orders/:id/set-lens-price', requireStaff, setLensPrice);

export default router;
