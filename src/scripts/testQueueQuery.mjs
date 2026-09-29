import '../../dist/config/env.js';
import { InvoiceItem } from '../../dist/models/InvoiceItem.model.js';
import { Invoice } from '../../dist/models/Invoice.model.js';
import { matchesMongoFilter } from '../../dist/lib/firestoreModel.js';

async function run() {
  const query = {
    $or: [
      { fulfillmentSource: 'ordered' },
      { lensType: { $exists: true, $ne: null } },
      { opticalLens: { $exists: true, $ne: null } },
    ],
    $and: [
      { $or: [{ sentToWholesaler: { $ne: true } }, { labStatus: 'pending' }] },
      { labStatus: { $nin: ['received', 'fitted', 'cancelled'] } },
    ],
  };

  const items = await InvoiceItem.find(query).lean();
  console.log('Items returned by query:', items.length);
  for (const it of items) {
    console.log(' -> Item ID:', it._id, 'userName:', it.userName, 'lensType:', it.lensType, 'labStatus:', it.labStatus, 'sent:', it.sentToWholesaler);
  }

  const target = await InvoiceItem.findById('TbzZQt7IqZY0yf3eVRSR');
  console.log('\nDirect fetch target TbzZQt7IqZY0yf3eVRSR:', !!target);
  if (target) {
    console.log('Matches full query?', matchesMongoFilter(target, query));
    console.log('Matches $or?', matchesMongoFilter(target, { $or: query.$or }));
    console.log('Matches $and?', matchesMongoFilter(target, { $and: query.$and }));
    console.log('fulfillmentSource:', target.fulfillmentSource);
    console.log('labStatus:', target.labStatus);
    console.log('sentToWholesaler:', target.sentToWholesaler);
  }

  process.exit(0);
}

run().catch(console.error);
