import mongoose, { Schema, Document } from 'mongoose';

export type ProductCategory = 'frame' | 'opticalLens' | 'fragrance' | 'contact_lens' | 'sunglasses' | 'accessory';
export type HealthStatus = 'healthy' | 'low_stock' | 'overstock' | 'dead_stock';

export interface IInventorySnapshot extends Document {
  snapshotDate: Date;
  category: ProductCategory;
  productId?: mongoose.Types.ObjectId;
  productName: string;
  quantityOnHand: number;
  daysSinceLastSale: number;
  healthStatus: HealthStatus;
  recommendedAction?: string;
}

const InventorySnapshotSchema = new Schema<IInventorySnapshot>(
  {
    snapshotDate: { type: Date, required: true, default: Date.now },
    category: {
      type: String,
      required: true,
      enum: ['frame', 'opticalLens', 'fragrance', 'contact_lens', 'sunglasses', 'accessory'],
    },
    productId: { type: Schema.Types.ObjectId },
    productName: { type: String, required: true, trim: true },
    quantityOnHand: { type: Number, required: true, min: 0 },
    daysSinceLastSale: { type: Number, required: true, min: 0 },
    healthStatus: {
      type: String,
      required: true,
      enum: ['healthy', 'low_stock', 'overstock', 'dead_stock'],
    },
    recommendedAction: { type: String },
  },
  { timestamps: true }
);

InventorySnapshotSchema.index({ snapshotDate: -1 });
InventorySnapshotSchema.index({ healthStatus: 1, snapshotDate: -1 });
InventorySnapshotSchema.index({ category: 1, snapshotDate: -1 });

export const InventorySnapshot = mongoose.model<IInventorySnapshot>(
  'InventorySnapshot',
  InventorySnapshotSchema
);
