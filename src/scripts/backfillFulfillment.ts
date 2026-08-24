/**
 * One-time migration: marks all pre-existing lens InvoiceItems as fulfillmentSource='ordered'
 * and backfills requestedQty / fulfilledQty from quantity where null.
 *
 * Run with:  npx ts-node src/scripts/backfillFulfillment.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { InvoiceItem } from '../models/InvoiceItem.model';

async function migrate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/billing';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  // Target: lens items with no fulfillmentSource field (pre-schema records) OR explicit 'stock'
  const filter = {
    lensType: { $exists: true, $ne: null },
    $or: [
      { fulfillmentSource: { $exists: false } },
      { fulfillmentSource: 'stock' },
    ],
  };

  // Diagnostic
  const totalItems = await InvoiceItem.countDocuments({});
  const withLensType = await InvoiceItem.countDocuments({ lensType: { $exists: true, $ne: null } });
  console.log(`DB totals — all InvoiceItems: ${totalItems}, with lensType set: ${withLensType}`);

  const total = await InvoiceItem.countDocuments(filter);
  console.log(`Found ${total} lens InvoiceItems with fulfillmentSource='stock' to migrate`);

  if (total === 0) {
    console.log('Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  // Aggregation pipeline update — allows $ifNull to copy quantity into null fields atomically
  const result = await InvoiceItem.updateMany(filter, [
    {
      $set: {
        fulfillmentSource: 'ordered',
        requestedQty: { $ifNull: ['$requestedQty', '$quantity'] },
        fulfilledQty:  { $ifNull: ['$fulfilledQty',  '$quantity'] },
      },
    },
  ], { updatePipeline: true } as any);

  console.log(`Migrated ${result.modifiedCount} of ${total} items → fulfillmentSource='ordered'`);
  await mongoose.disconnect();
  console.log('Done.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
