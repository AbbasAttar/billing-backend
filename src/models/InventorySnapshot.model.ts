import { createFirestoreModel, BaseDoc, expireAfterDays } from '../lib/firestoreModel';

export type ProductCategory = 'frame' | 'opticalLens' | 'fragrance' | 'contact_lens' | 'sunglasses' | 'accessory';
export type HealthStatus = 'healthy' | 'low_stock' | 'overstock' | 'dead_stock';

export interface IInventorySnapshot extends BaseDoc {
  snapshotDate: Date;
  category: ProductCategory;
  productId?: string | any;
  productName: string;
  quantityOnHand: number;
  daysSinceLastSale: number;
  healthStatus: HealthStatus;
  recommendedAction?: string;
  createdAt?: Date;
  updatedAt?: Date;
  /** TTL: Firestore deletes the doc after this time. */
  expireAt?: Date;
}

/** Firestore TTL deletes snapshots after this long (see firestore.indexes.json). */
export const INVENTORY_SNAPSHOT_TTL_DAYS = 365;

export const InventorySnapshot = createFirestoreModel<IInventorySnapshot>('inventorysnapshots', {
  beforeWrite: (payload, ctx) => {
    if (ctx.full && !payload.expireAt) {
      payload.expireAt = expireAfterDays(payload.snapshotDate ?? payload.createdAt, INVENTORY_SNAPSHOT_TTL_DAYS);
    }
  },
});
