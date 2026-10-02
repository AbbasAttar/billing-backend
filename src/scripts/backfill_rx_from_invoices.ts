import 'dotenv/config';
import { PurchaseEntry } from '../models/PurchaseEntry.model';
import { Invoice } from '../models/Invoice.model';
import { InvoiceItem } from '../models/InvoiceItem.model';

async function main() {
  console.log('=== Checking and Syncing Rx from linked Invoices to PurchaseEntries ===');

  const [allEntries, allInvoices, allInvoiceItems] = await Promise.all([
    PurchaseEntry.find({}).lean(),
    Invoice.find({}).lean(),
    InvoiceItem.find({}).lean(),
  ]);

  const invoiceItemsMap = new Map<string, any>();
  for (const it of allInvoiceItems) {
    invoiceItemsMap.set(String(it._id || it.id), it);
  }

  const invoicesByNum = new Map<string, any>();
  const invoicesById = new Map<string, any>();
  for (const inv of allInvoices) {
    const invId = String(inv._id || inv.id);
    const invNum = (inv.invoiceNumber || '').toLowerCase().trim();
    const cleanNum = invNum.replace(/[^a-zA-Z0-9]/g, '');
    invoicesById.set(invId, inv);
    if (invNum) invoicesByNum.set(invNum, inv);
    if (cleanNum) invoicesByNum.set(cleanNum, inv);
  }

  let updatedCount = 0;

  for (const entry of allEntries) {
    const entryId = String(entry._id || entry.id);
    const ref = (entry.supplierInvoiceRef || entry.purchaseInvoiceId || '').trim();
    if (!ref) continue;

    const matchedInv =
      invoicesByNum.get(ref.toLowerCase()) ||
      invoicesByNum.get(ref.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()) ||
      invoicesById.get(ref);

    if (!matchedInv || !Array.isArray(matchedInv.items) || matchedInv.items.length === 0) continue;

    const matchedItems = matchedInv.items
      .map((itId: any) => invoiceItemsMap.get(String(itId)))
      .filter(Boolean);

    if (matchedItems.length === 0) continue;

    // Pick best matching item
    const lensItems = matchedItems.filter((it: any) => it.type === 'lens' || it.lensType || it.lensCoating || it.lensLabel);
    const candidateList = lensItems.length > 0 ? lensItems : matchedItems;

    const matchedItem = candidateList.find((it: any) => {
      const notes = (entry.notes || '').toLowerCase();
      if (notes && it.lensLabel && (it.lensLabel.toLowerCase().includes(notes) || notes.includes(it.lensLabel.toLowerCase()))) return true;
      if (notes && it.userName && (it.userName.toLowerCase().includes(notes) || notes.includes(it.userName.toLowerCase()))) return true;
      if (entry.coating && it.lensCoating && it.lensCoating.toLowerCase() === entry.coating.toLowerCase()) return true;
      return false;
    }) || candidateList[0];

    if (!matchedItem) continue;

    const itSph = matchedItem.rightSpherical ?? matchedItem.spherical ?? matchedItem.leftSpherical ?? null;
    const itCyl = matchedItem.rightCylinder ?? matchedItem.cylinder ?? matchedItem.leftCylinder ?? null;
    const itAdd = matchedItem.rightAddition ?? matchedItem.addition ?? matchedItem.leftAddition ?? null;

    // If purchase entry has sph === null or undefined, or cyl === 0 while item has cyl != 0
    const needsSphUpdate = (entry.sph === null || entry.sph === undefined) && itSph !== null && itSph !== undefined;
    const needsCylUpdate = (entry.cyl === null || entry.cyl === undefined || entry.cyl === 0) && itCyl !== null && itCyl !== undefined && itCyl !== 0;
    const needsAddUpdate = (entry.add === null || entry.add === undefined) && itAdd !== null && itAdd !== undefined && itAdd !== 0;

    if (needsSphUpdate || needsCylUpdate || needsAddUpdate) {
      const updateData: any = {};
      if (needsSphUpdate) updateData.sph = itSph;
      if (needsCylUpdate) updateData.cyl = itCyl;
      if (needsAddUpdate) updateData.add = itAdd;

      console.log(`Updating Entry ${entryId} (${entry.notes || 'No notes'}) from Inv ${matchedInv.invoiceNumber}:`, updateData);
      await PurchaseEntry.findByIdAndUpdate(entryId, { $set: updateData });
      updatedCount++;
    }
  }

  console.log(`=== Done! Updated ${updatedCount} entries with prescription numbers ===`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
