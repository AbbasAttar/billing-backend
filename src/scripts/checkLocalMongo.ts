import mongoose from 'mongoose';

async function checkLocalMongo() {
  try {
    console.log('Checking local mongodb://localhost:27017 ...');
    await mongoose.connect('mongodb://localhost:27017', { serverSelectionTimeoutMS: 3000 });
    console.log('Connected to local Mongo!');
    const admin = mongoose.connection.db?.admin();
    if (admin) {
      const dbs = await admin.listDatabases();
      console.log('Local DBs:', dbs);
    }
    await mongoose.disconnect();
  } catch (err: any) {
    console.log('Local MongoDB not running or unreachable:', err.message);
  }
  process.exit(0);
}

checkLocalMongo();
