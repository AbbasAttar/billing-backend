import mongoose, { Schema, Document } from 'mongoose';

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

export type OrderStatus = 'pending' | 'paid' | 'preparing' | 'ready' | 'dispatched' | 'fulfilled' | 'cancelled';

export interface IOrder extends Document {
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  delivery: 'home' | 'pickup';
  address?: string;
  city?: string;
  pincode?: string;
  items: IOrderItem[];
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
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    name:      { type: String, required: true },
    qty:       { type: Number, required: true, min: 1 },
    price:     { type: Number, required: true, min: 0 },
    productId: { type: String },
    slug:      { type: String },
    category:  { type: String },
    brand:     { type: String },
    image:     { type: String },
  },
  { _id: false }
);

const OrderSchema = new Schema<IOrder>(
  {
    razorpayOrderId:   { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String },
    status:            { type: String, enum: ['pending', 'paid', 'preparing', 'ready', 'dispatched', 'fulfilled', 'cancelled'], default: 'pending' },
    customerName:      { type: String, required: true, trim: true },
    customerPhone:     { type: String, required: true, trim: true },
    customerEmail:     { type: String, trim: true },
    delivery:          { type: String, enum: ['home', 'pickup'], default: 'home' },
    address:           { type: String, trim: true },
    city:              { type: String, trim: true },
    pincode:           { type: String, trim: true },
    items:                   { type: [OrderItemSchema], default: [] },
    subtotal:                { type: Number, required: true, min: 0 },
    shipping:                { type: Number, default: 0, min: 0 },
    total:                   { type: Number, required: true, min: 0 },
    note:                    { type: String, trim: true },
    lensQuotePending:        { type: Boolean, default: false },
    tokenAmount:             { type: Number, default: 0, min: 0 },
    adminLensPrice:          { type: Number, default: null },
    balanceRazorpayOrderId:  { type: String },
    balancePaid:             { type: Boolean, default: false },
    waybillNo:               { type: String, trim: true },
    courierName:             { type: String, trim: true },
  },
  { timestamps: true }
);

OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ customerPhone: 1 });

export const Order = mongoose.model<IOrder>('Order', OrderSchema);
