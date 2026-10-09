import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IOrderItem {
  name: string;
  qty: number;
  price: number;
  productId?: string;
  slug?: string;
  category?: string;
  brand?: string;
  image?: string;
}

/** Who the prescription lenses are for, as entered at checkout. */
export interface IOrderRecipient {
  name?: string;
  phone?: string;
  rxMethod?: string; // "manual" | "upload" | "later" etc., as sent by the storefront
  prescription?: {
    rightEye?: Record<string, string>;
    leftEye?: Record<string, string>;
    notes?: string;
  };
  prescriptionUrl?: string;
  prescriptionFileName?: string;
}

export type OrderStatus = 'pending' | 'paid' | 'preparing' | 'ready' | 'dispatched' | 'fulfilled' | 'cancelled';

export interface IOrder extends BaseDoc {
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  invoiceNumber?: string | null;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  delivery: 'home' | 'pickup';
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  items: IOrderItem[];
  recipients?: IOrderRecipient[];
  subtotal: number;
  shipping: number;
  total: number;
  note?: string;
  lensQuotePending: boolean;
  tokenAmount: number;
  adminLensPrice?: number | null;
  balanceRazorpayOrderId?: string;
  balancePaid: boolean;
  waybillNo?: string;
  courierName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const Order = createFirestoreModel<IOrder>('orders');
