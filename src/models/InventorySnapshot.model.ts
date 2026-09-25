import { createFirestoreModel, BaseDoc } from '../lib/firestoreModel';

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
}

export const InventorySnapshot = createFirestoreModel<IInventorySnapshot>('inventorysnapshots');
