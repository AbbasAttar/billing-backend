import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

/**
 * Bulk / wholesale stock sold by the unit (e.g. attar by the bottle), kept apart from the retail
 * frame and fragrance catalogues. Billed through the "Wholesale" tab of the invoice screen.
 */
export interface IWholesaleItem extends BaseDoc {
  name: string;
  /** Maker / supplier (WholesaleCompany id); the same product name can come from different companies. */
  companyId?: string;
  /** Copy of the company's name, kept in step when the company is renamed. */
  companyName?: string;
  /** Selling unit shown on the bill: "bottle", "dozen", "kg"… */
  unit: string;
  costPrice?: number;
  sellPrice: number;
  stock: number;
  reorderLevel?: number;
  notes?: string;
  /** Re-order tracking: set when the item is sent to the wholesaler on WhatsApp. */
  isOrdered?: boolean;
  /** In the order queue (/bulk-stock/order) until it is ordered or removed there. */
  inOrderQueue?: boolean;
  /** Quantity typed in the order queue so far. */
  queueQty?: number | null;
  orderedQty?: number | null;
  orderedAt?: Date | null;
  isArchived?: boolean;
  archivedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export const WholesaleItem = createFirestoreModel<IWholesaleItem>('wholesaleitems', {
  mirror: true,
  beforeWrite: (payload, ctx) => {
    // Always store the flag: a missing isArchived is invisible to Firestore `==` / `!=` queries.
    if (ctx.full && payload.isArchived === undefined) payload.isArchived = false;
  },
});
