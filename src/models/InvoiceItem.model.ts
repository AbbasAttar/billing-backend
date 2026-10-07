import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

export interface IInvoiceItem extends BaseDoc {
  type?: string;
  invoice?: string | any;
  invoiceId?: string;
  invoiceNumber?: string;
  frame?: string | any;
  opticalLens?: string | any;
  prescription?: string | any;
  fragrance?: string | any;
  eye?: 'left' | 'right' | 'both';
  userName?: string;
  spherical?: number;
  cylinder?: number;
  axis?: number;
  addition?: number;
  lensLabel?: string;
  quantity: number;
  price: number;
  costPrice?: number;
  mrp?: number;
  storePrice?: number;
  tier?: string;
  fragranceGrade?: string;
  lensBrand?: string;
  lensName?: string;
  lensCategory?: string;
  lensIndex?: string;
  lensCoating?: string;
  frameVariantLabel?: string;
  rightEyeNumber?: string;
  leftEyeNumber?: string;
  lensCompany?: string;
  lensType?: string;
  lensMaterial?: string;
  lensColor?: string;
  isCustomLens?: boolean;
  isSameNumber?: boolean;
  fulfillmentSource: 'stock' | 'ordered' | 'unfulfilled';
  requestedQty?: number | null;
  fulfilledQty?: number | null;
  sentToWholesaler?: boolean;
  wholesalerOrderDate?: Date | null;
  labStatus?: 'pending' | 'sent' | 'received' | 'fitted' | 'cancelled';
  labReceivedDate?: Date | null;
  labFittedDate?: Date | null;
  rightSpherical?: number | null;
  rightCylinder?: number | null;
  rightAxis?: number | null;
  rightAddition?: number | null;
  leftSpherical?: number | null;
  leftCylinder?: number | null;
  leftAxis?: number | null;
  leftAddition?: number | null;
  /** Derived on every write (see computeLabFlags): item belongs in the wholesaler / lab queue. */
  isLabItem?: boolean;
  /** Derived: labStatus is not received / fitted / cancelled. */
  isOpenLabJob?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const CLOSED_LAB_STATUSES = ['received', 'fitted', 'cancelled'];

const isSet = (v: unknown) => v !== undefined && v !== null;

/**
 * Lab-queue flags, so the wholesaler queue is a native Firestore query instead of a
 * full scan with an `$or` / `$exists` filter. Mirrors the rules the queue used to apply.
 */
export function computeLabFlags(item: {
  type?: unknown;
  fulfillmentSource?: unknown;
  lensType?: unknown;
  opticalLens?: unknown;
  labStatus?: unknown;
}): { isLabItem: boolean; isOpenLabJob: boolean } {
  return {
    isLabItem:
      item.type === 'opticalLens' ||
      item.fulfillmentSource === 'ordered' ||
      isSet(item.lensType) ||
      isSet(item.opticalLens),
    isOpenLabJob: !CLOSED_LAB_STATUSES.includes(item.labStatus as string),
  };
}

const LAB_FIELDS = ['type', 'fulfillmentSource', 'lensType', 'opticalLens'];

export const InvoiceItem = createFirestoreModel<IInvoiceItem>('invoiceitems', {
  mirror: true,
  beforeWrite: async (payload, ctx) => {
    if (ctx.full) {
      Object.assign(payload, computeLabFlags(payload));
      return;
    }
    // Partial update: recompute only what the changed fields can affect.
    const touchesLabFields = LAB_FIELDS.some((f) => f in payload);
    const touchesStatus = 'labStatus' in payload;
    if (!touchesLabFields && !touchesStatus) return;

    // isLabItem depends on fields the update may not carry, so merge with the stored doc.
    const merged = touchesLabFields ? { ...((await ctx.getExisting()) ?? {}), ...payload } : payload;
    const flags = computeLabFlags(merged);
    if (touchesLabFields) payload.isLabItem = flags.isLabItem;
    payload.isOpenLabJob = flags.isOpenLabJob;
  },
});
