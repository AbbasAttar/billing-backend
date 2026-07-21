import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { env } from '../config/env';
import { Order } from '../models/Order.model';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

function getCredentials() {
  return Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
}

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      amount,
      customerName,
      customerPhone,
      customerEmail,
      delivery,
      address,
      city,
      pincode,
      items = [],
      shipping = 0,
    } = req.body as {
      amount: number;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      delivery?: 'home' | 'pickup';
      address?: string;
      city?: string;
      pincode?: string;
      items?: { name: string; qty: number; price: number }[];
      shipping?: number;
    };

    if (!amount || amount <= 0) {
      res.status(400).json({ message: 'Invalid amount' });
      return;
    }

    const response = await fetch(`${RAZORPAY_API}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${getCredentials()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100),
        currency: 'INR',
        receipt: `receipt_${Date.now()}`,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      res.status(502).json({ message: 'Razorpay order creation failed', error });
      return;
    }

    const rzpOrder = await response.json() as { id: string };

    // Save pending order to DB if customer info is present
    if (customerName && customerPhone) {
      const subtotal = amount - (shipping ?? 0);
      await Order.create({
        razorpayOrderId: rzpOrder.id,
        status: 'pending',
        customerName,
        customerPhone,
        customerEmail,
        delivery: delivery ?? 'home',
        address,
        city,
        pincode,
        items,
        subtotal: Math.max(0, subtotal),
        shipping: shipping ?? 0,
        total: amount,
      });
    }

    res.json({ orderId: rzpOrder.id, keyId: env.RAZORPAY_KEY_ID, currency: 'INR' });
  } catch (error) {
    next(error);
  }
};

export const verifyPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body as {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    };

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      res.status(400).json({ message: 'Missing payment verification fields' });
      return;
    }

    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      res.status(400).json({ message: 'Payment verification failed: signature mismatch' });
      return;
    }

    // Mark order as paid
    await Order.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { status: 'paid', razorpayPaymentId: razorpay_payment_id }
    );

    res.json({ success: true, paymentId: razorpay_payment_id, orderId: razorpay_order_id });
  } catch (error) {
    next(error);
  }
};

export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const filter: Record<string, unknown> = {};
    if (status && status !== 'all') filter.status = status;

    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, data: orders });
  } catch (error) {
    next(error);
  }
};

export const handleWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    const secret = env.RAZORPAY_WEBHOOK_SECRET;

    // req.body is a raw Buffer (mounted before express.json())
    const rawBody = req.body as Buffer;

    if (secret) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      if (signature !== expected) {
        res.status(400).json({ message: 'Invalid webhook signature' });
        return;
      }
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const event = payload?.event as string;
    const payment = payload?.payload?.payment?.entity;

    if (event === 'payment.captured' && payment) {
      const razorpayOrderId: string = payment.order_id;
      const razorpayPaymentId: string = payment.id;
      await Order.findOneAndUpdate(
        { razorpayOrderId },
        { status: 'paid', razorpayPaymentId }
      );
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body as { status: string; note?: string };

    const allowed = ['pending', 'paid', 'fulfilled', 'cancelled'];
    if (!allowed.includes(status)) {
      res.status(400).json({ message: 'Invalid status' });
      return;
    }

    const order = await Order.findByIdAndUpdate(
      id,
      { status, ...(note !== undefined ? { note } : {}) },
      { new: true }
    ).lean();

    if (!order) { res.status(404).json({ message: 'Order not found' }); return; }
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};
