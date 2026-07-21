import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { env } from '../config/env';
import { Order } from '../models/Order.model';
import { sendNewOrderNotification } from '../services/fcm';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

async function fireOrderNotifications(order: {
  customerName: string;
  total: number;
  items: { name: string; qty: number; price: number }[];
}): Promise<void> {
  sendNewOrderNotification(order.customerName, order.total, order.items.length).catch(() => {});
}

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
      lensQuotePending = false,
      tokenAmount = 0,
    } = req.body as {
      amount: number;
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      delivery?: 'home' | 'pickup';
      address?: string;
      city?: string;
      pincode?: string;
      items?: { name: string; qty: number; price: number; productId?: string; slug?: string; category?: string; brand?: string; image?: string }[];
      shipping?: number;
      lensQuotePending?: boolean;
      tokenAmount?: number;
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
        lensQuotePending: !!lensQuotePending,
        tokenAmount: tokenAmount ?? 0,
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
    const paidOrder = await Order.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { status: 'paid', razorpayPaymentId: razorpay_payment_id },
      { new: true }
    ).lean();

    if (paidOrder) {
      fireOrderNotifications(paidOrder as any).catch(() => {});
    }

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
      const webhookOrder = await Order.findOneAndUpdate(
        { razorpayOrderId },
        { status: 'paid', razorpayPaymentId },
        { new: true }
      ).lean();
      if (webhookOrder) {
        fireOrderNotifications(webhookOrder as any).catch(() => {});
      }
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
};

export const setLensPrice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { adminLensPrice } = req.body as { adminLensPrice: number };

    if (typeof adminLensPrice !== 'number' || adminLensPrice < 0) {
      res.status(400).json({ message: 'adminLensPrice must be a non-negative number' });
      return;
    }

    const order = await Order.findByIdAndUpdate(
      id,
      { adminLensPrice },
      { new: true }
    ).lean();

    if (!order) { res.status(404).json({ message: 'Order not found' }); return; }
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const createBalanceOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id).lean();

    if (!order) { res.status(404).json({ message: 'Order not found' }); return; }
    if (!order.lensQuotePending) { res.status(400).json({ message: 'No lens quote pending on this order' }); return; }
    if (order.balancePaid) { res.status(400).json({ message: 'Balance already paid' }); return; }
    if (!order.adminLensPrice || order.adminLensPrice <= 0) {
      res.status(400).json({ message: 'Admin has not set the lens price yet' });
      return;
    }

    const remainingAmount = order.adminLensPrice - (order.tokenAmount ?? 0);
    if (remainingAmount <= 0) {
      res.status(400).json({ message: 'No balance remaining' });
      return;
    }

    const response = await fetch(`${RAZORPAY_API}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${getCredentials()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: Math.round(remainingAmount * 100),
        currency: 'INR',
        receipt: `balance_${id}_${Date.now()}`,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      res.status(502).json({ message: 'Razorpay balance order creation failed', error });
      return;
    }

    const rzpOrder = await response.json() as { id: string };
    await Order.findByIdAndUpdate(id, { balanceRazorpayOrderId: rzpOrder.id });

    res.json({ orderId: rzpOrder.id, keyId: env.RAZORPAY_KEY_ID, currency: 'INR', remainingAmount });
  } catch (error) {
    next(error);
  }
};

export const verifyBalancePayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body as {
      orderId: string;
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    };

    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      res.status(400).json({ message: 'Signature mismatch' });
      return;
    }

    const order = await Order.findByIdAndUpdate(
      orderId,
      { balancePaid: true, status: 'paid' },
      { new: true }
    ).lean();

    if (!order) { res.status(404).json({ message: 'Order not found' }); return; }
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, note, waybillNo, courierName } = req.body as {
      status: string;
      note?: string;
      waybillNo?: string;
      courierName?: string;
    };

    const allowed = ['pending', 'paid', 'preparing', 'ready', 'dispatched', 'fulfilled', 'cancelled'];
    if (!allowed.includes(status)) {
      res.status(400).json({ message: 'Invalid status' });
      return;
    }

    if (status === 'dispatched' && (!waybillNo || !courierName)) {
      res.status(400).json({ message: 'waybillNo and courierName are required when marking dispatched' });
      return;
    }

    const update: Record<string, unknown> = { status };
    if (note !== undefined) update.note = note;
    if (status === 'dispatched') {
      update.waybillNo = waybillNo;
      update.courierName = courierName;
    }

    const order = await Order.findByIdAndUpdate(id, update, { new: true }).lean();

    if (!order) { res.status(404).json({ message: 'Order not found' }); return; }
    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};
