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
  eye: "left" | "right";
  opticalLens?: string;
  prescription?: string;
  userName?: string;
  spherical?: number | null;
  cylinder?: number | null;
  axis?: number | null;
  addition?: number | null;
  lensLabel?: string;
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
  discount?: number;          // optional discount in rupees (default 0)
  billDate?: string;          // ISO date string (default: today)
}
