import { Router } from 'express';
import {
  createOrder, verifyPayment, listOrders, updateOrderStatus, handleWebhook,
  setLensPrice, createBalanceOrder, verifyBalancePayment, deleteOrder,
} from '../controllers/razorpay.controller';

const router = Router();

router.post('/create-order', createOrder);
router.post('/verify-payment', verifyPayment);
router.post('/webhook', handleWebhook);
router.get('/orders', listOrders);
router.patch('/orders/:id/status', updateOrderStatus);
router.delete('/orders/:id', deleteOrder);
router.patch('/orders/:id/set-lens-price', setLensPrice);
router.post('/orders/:id/create-balance-order', createBalanceOrder);
router.post('/verify-balance-payment', verifyBalancePayment);

export default router;
