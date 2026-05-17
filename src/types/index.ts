export interface CreateFrameItemInput {
  type: 'frame';
  frame: string;
  quantity: number;
  price: number;
}

export interface CreateFragranceItemInput {
  type: 'fragrance';
  fragrance: string;
  quantity: number;
  price: number;
}

export interface CreateOpticalLensItemInput {
  type: "opticalLens";
  eye?: "left" | "right" | "both";
  // Lens catalogue fields (new)
  lensBrand?: string;
  lensName?: string;
  lensCategory?: string;
  lensIndex?: string;
  lensCoating?: string;
  // Existing fields
  opticalLens?: string;
  prescription?: string;
  userName?: string;
  lensLabel?: string;
  spherical?: number | null;
  cylinder?: number | null;
  axis?: number | null;
  addition?: number | null;
  rightEyeNumber?: string | null;
  leftEyeNumber?: string | null;
  lensCompany?: string | null;
  lensType?: string | null;
  isSameNumber?: boolean;
  quantity: number;
  price: number;
}

export type CreateInvoiceItemInput =
  | CreateFrameItemInput
  | CreateFragranceItemInput
  | CreateOpticalLensItemInput;

export interface CreateInvoiceInput {
  customer?: string;          // ObjectId if existing customer
  customerName?: string;
  customerAddress?: string;
  customerMobile?: string;
  items: CreateInvoiceItemInput[];
  initialPayment?: number;    // optional upfront payment recorded at creation time
  initialPayments?: Array<{
    date?: string;
    amount: number;
    method: 'cash' | 'online';
  }>;
  discount?: number;          // optional discount in rupees (default 0)
  billDate?: string;          // ISO date string (default: today)
}

export type ExpenseCategory =
  | 'rent'
  | 'salary'
  | 'utilities'
  | 'stock'
  | 'maintenance'
  | 'transport'
  | 'marketing'
  | 'miscellaneous';

export type PaymentMethod = 'cash' | 'upi' | 'card' | 'bank_transfer';

export interface IExpenseDto {
  _id: string;
  date: string;
  amount: number;
  category: ExpenseCategory;
  note?: string;
  vendorName?: string;
  paymentMethod: PaymentMethod;
  isVoid: boolean;
  voidReason?: string;
  createdAt: string;
}

export interface IExpenseSummaryDto {
  totalExpenses: number;
  byCategory: Record<ExpenseCategory, number>;
  byPaymentMethod: Record<PaymentMethod, number>;
  count: number;
}

export interface IPendingInvoiceDto {
  invoiceId: string;
  billDate: string;
  customer: { _id: string; name: string; mobileNumber: string };
  total: number;
  paid: number;
  balance: number;
  daysPending: number;
  agingBucket: '0-7' | '8-30' | '31-60' | '61-90' | '90+';
  lastPayment: { date: string; amount: number; method: 'cash' | 'online' } | null;
}

export interface IGivenPaymentDto {
  invoiceId: string;
  customer: { _id: string; name: string; mobileNumber: string };
  paymentDate: string;
  amount: number;
  invoiceTotal: number;
  isClearing: boolean;
  method: 'cash' | 'online';
}
