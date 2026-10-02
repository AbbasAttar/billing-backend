import { Invoice } from '../src/models/Invoice.model';
import { InvoiceItem } from '../src/models/InvoiceItem.model';
import { PurchaseEntry } from '../src/models/PurchaseEntry.model';

async function checkInvoiceStats() {
  const [invoices, items, purchases] = await Promise.all([
    Invoice.find({}).lean(),
    InvoiceItem.find({}).lean(),
    PurchaseEntry.find({}).lean(),
  ]);

  console.log(`Total Invoices in DB: ${invoices.length}`);
  console.log(`Total InvoiceItems in DB: ${items.length}`);
  console.log(`Total Purchase Entries in DB: ${purchases.length}`);

  let invoicesWithLenses = 0;
  let invoicesWithFramesOnly = 0;
  let invoicesWithFragrancesOnly = 0;

  const itemMap = new Map<string, any>();
  for (const it of items) {
    itemMap.set(String(it._id), it);
  }

  for (const inv of invoices) {
    if (!Array.isArray(inv.items) || inv.items.length === 0) continue;
    let hasLens = false;
    let hasFrame = false;
    let hasFragrance = false;

    for (const itId of inv.items) {
      const it = itemMap.get(String(itId));
      if (!it) continue;
      if (it.fragrance || it.type === 'fragrance' || (it.quantity === 0.25 && !it.lensType)) {
        hasFragrance = true;
      } else if (it.frame || it.type === 'frame') {
        hasFrame = true;
      } else {
        hasLens = true;
      }
    }

    if (hasLens) invoicesWithLenses++;
    else if (hasFrame) invoicesWithFramesOnly++;
    else if (hasFragrance) invoicesWithFragrancesOnly++;
  }

  console.log(`Invoices with Optical Lenses: ${invoicesWithLenses}`);
  console.log(`Invoices with Frames only: ${invoicesWithFramesOnly}`);
  console.log(`Invoices with Fragrances/Attars only: ${invoicesWithFragrancesOnly}`);
}

checkInvoiceStats().catch(console.error);
