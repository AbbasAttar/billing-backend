import mongoose from 'mongoose';
import { env } from '../config/env';

async function checkAllDatabases() {
  console.log('Connecting to MongoDB cluster:', env.MONGODB_URI.substring(0, 35) + '...');
  await mongoose.connect(env.MONGODB_URI);

  const admin = mongoose.connection.db?.admin();
  if (!admin) {
    console.error('Admin DB not available');
    return;
  }

  const dbsResult = await admin.listDatabases();
  console.log('\n==================================================');
  console.log('FOUND DATABASES ON MONGODB CLUSTER:');
  console.log('==================================================');
  for (const dbInfo of dbsResult.databases) {
    console.log(`\n📌 Database: [${dbInfo.name}] (Size: ${dbInfo.sizeOnDisk} bytes)`);
    const dbClient = (mongoose.connection as any).client.db(dbInfo.name);
    const collections = await dbClient.listCollections().toArray();
    for (const col of collections) {
      const count = await dbClient.collection(col.name).countDocuments();
      if (count > 0) {
        console.log(`   - ${col.name}: ${count} docs`);
      }
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

checkAllDatabases().catch((err) => {
  console.error('Error listing Mongo DBs:', err);
  process.exit(1);
});
