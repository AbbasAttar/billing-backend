import { Router } from 'express';
import { createOrder, verifyPayment, listOrders, updateOrderStatus, handleWebhook } from '../controllers/razorpay.controller';

const router = Router();

router.post('/create-order', createOrder);
router.post('/verify-payment', verifyPayment);
router.post('/webhook', handleWebhook);
router.get('/orders', listOrders);
router.patch('/orders/:id/status', updateOrderStatus);

export default router;
