export interface InlineOpticalNumberInput {
  name: string;
  leftSpherical?: number;
  leftCylinder?: number;
  leftAddition?: number;
  leftAxis?: number;
  rightSpherical?: number;
  rightCylinder?: number;
  rightAddition?: number;
  rightAxis?: number;
  lensType?: string;
}

export interface CreateInvoiceItemInput {
  type: 'frame' | 'opticalLens' | 'fragrance';
  frame?: string;
  opticalLens?: string;
  prescription?: string;
  inlineOpticalNumber?: InlineOpticalNumberInput;
  fragrance?: string;
  quantity: number;
  price: number;
}

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
