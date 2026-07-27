/**
 * One-time migration: removes the legacy `web.colors` field from all Frame documents.
 * Frame colors are now stored exclusively in `web.frameVariants`.
 *
 * Run with: npx ts-node -r tsconfig-paths/register src/scripts/clear-frame-colors.ts
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/billing';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const result = await mongoose.connection
    .collection('frames')
    .updateMany(
      { 'web.colors': { $exists: true } },
      { $unset: { 'web.colors': '' } },
    );

  console.log(`Cleared web.colors from ${result.modifiedCount} frame(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
