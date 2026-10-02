import { Invoice } from '../src/models/Invoice.model';
import { InvoiceItem } from '../src/models/InvoiceItem.model';
import { Customer } from '../src/models/Customer.model';
import { PurchaseEntry } from '../src/models/PurchaseEntry.model';
import { getDb } from '../src/lib/firestoreDb';
import { invalidateInvoiceLookupCache } from '../src/controllers/purchaseEntry.controller';

function parseEyeNumberString(eyeStr: string | null | undefined, isBifocalOrProg: boolean) {
  if (!eyeStr || !eyeStr.trim()) return { sph: null, cyl: null, axis: null, add: null };
  const parts = eyeStr.split('/').map(s => s.trim());

  let sph: number | null = null;
  let cyl: number | null = null;
  let axis: number | null = null;
  let add: number | null = null;

  for (const part of parts) {
    if (part.toLowerCase().startsWith('x')) {
      const axNum = parseFloat(part.slice(1).trim());
      if (!isNaN(axNum)) axis = axNum;
    } else {
      const val = parseFloat(part);
      if (!isNaN(val)) {
        if (sph === null) {
          sph = val;
        } else if (isBifocalOrProg && add === null && val > 0 && !part.includes('cyl')) {
          add = val;
        } else if (cyl === null) {
          cyl = val;
        } else if (add === null) {
          add = val;
        }
      }
    }
  }

  return { sph, cyl, axis, add };
}

async function executeResync() {
  console.log('--- STARTING CLEAN RE-SYNC OF ALL INWARD PURCHASES ---');
  const db = getDb();

  // 1. Purge current purchaseentries
  console.log('Purging existing contaminated entries from purchaseentries...');
  const snap = await db.collection('purchaseentries').get();
  console.log(`Found ${snap.docs.length} entries to delete.`);
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    const chunk = snap.docs.slice(i, i + 400);
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
    console.log(`Deleted chunk ${i + 1} to ${i + chunk.length}`);
  }

  // 2. Fetch fresh invoices, items, customers
  console.log('Fetching invoices, items, customers...');
  const [invoices, items, customers] = await Promise.all([
    Invoice.find({}).lean(),
    InvoiceItem.find({}).lean(),
    Customer.find({}).lean(),
  ]);

  const customerMap = new Map<string, string>();
  for (const c of customers) {
    const cid = String(c._id);
    customerMap.set(cid, c.name || 'Walk-in Client');
  }

  const invById = new Map<string, any>();
  const invByItemId = new Map<string, any>();
  const invByNumber = new Map<string, any>();

  for (const inv of invoices) {
    const invId = String(inv._id);
    invById.set(invId, inv);
    if (inv.invoiceNumber) {
      invByNumber.set(inv.invoiceNumber.toLowerCase().trim(), inv);
    }
    if (Array.isArray(inv.items)) {
      for (const itId of inv.items) {
        invByItemId.set(String(itId), inv);
      }
    }
  }

  // 3. Filter strictly true lenses (no fragrances, no frames)
  const lensItems = items.filter(it => {
    if (it.fragrance || it.type === 'fragrance' || (it.quantity === 0.25 && !it.lensType)) return false;
    if (it.frame || it.type === 'frame') return false;
    const hasRx = (
      (it.spherical !== undefined && it.spherical !== null) ||
      (it.rightSpherical !== undefined && it.rightSpherical !== null) ||
      (it.leftSpherical !== undefined && it.leftSpherical !== null) ||
      (it.cylinder !== undefined && it.cylinder !== null) ||
      (it.rightCylinder !== undefined && it.rightCylinder !== null) ||
      (it.leftCylinder !== undefined && it.leftCylinder !== null) ||
      Boolean(it.rightEyeNumber || it.leftEyeNumber)
    );
    const isLens = Boolean(
      it.type === 'opticalLens' ||
      it.opticalLens ||
      it.isCustomLens ||
      it.lensType ||
      it.lensMaterial ||
      it.lensCoating ||
      it.lensCategory
    );
    return hasRx || isLens;
  });

  console.log(`Processing ${lensItems.length} true optical lens items from invoices...`);

  const entriesToBatch: any[] = [];
  const alreadyImported = new Set<string>();
  let createdCount = 0;

  for (const item of lensItems) {
    const itId = String(item._id);
    if (alreadyImported.has(itId) || alreadyImported.has(`${itId}_re`) || alreadyImported.has(`${itId}_le`)) {
      continue;
    }

    // Resolve Invoice
    let inv = invByItemId.get(itId);
    if (!inv && item.invoice) inv = invById.get(String(item.invoice));
    if (!inv && item.invoiceId) inv = invById.get(String(item.invoiceId));
    if (!inv && item.invoiceNumber) inv = invByNumber.get(String(item.invoiceNumber).toLowerCase().trim());

    const invNumber = inv?.invoiceNumber || (item.invoiceNumber ? String(item.invoiceNumber) : null);
    const invId = inv ? String(inv._id) : null;
    const customerName = inv?.customer
      ? (customerMap.get(String(inv.customer)) || 'Customer')
      : (item.userName || item.lensLabel || 'Walk-in Client');

    // 4 Specs
    const rawType = `${item.lensType || item.lensCategory || ''}`.toLowerCase();
    const rawMat = `${item.lensMaterial || ''}`.toLowerCase();
    const rawCol = `${item.lensColor || ''}`.toLowerCase();
    const rawCoat = `${item.lensCoating || ''}`.toLowerCase();

    const lensType = rawType.includes('prog')
      ? 'Progressive'
      : (rawType.includes('bi') || rawType.includes('kt') || rawType.includes('kryptok'))
      ? 'Bifocal'
      : 'Single Vision';

    const material = rawMat.includes('poly') || rawMat.includes('pc')
      ? 'Polycarbonate'
      : rawMat.includes('glass')
      ? 'Glass'
      : 'Fiber';

    const color = (rawCol.includes('photo') || rawCol.includes('pg') || rawCol.includes('pb') || rawCoat.includes('photo'))
      ? 'Photo Chromatic'
      : rawCol.includes('polar')
      ? 'Polarized'
      : rawCol.includes('tint')
      ? 'Tinted'
      : 'White';

    let coating = (item.lensCoating && item.lensCoating.trim()) || '';
    if (!coating) {
      if (rawCoat.includes('blue') || rawCoat.includes('bb') || rawCoat.includes('blue cut')) {
        coating = 'Blue Block';
      } else if (rawCoat.includes('hc') || rawCoat.includes('hard')) {
        coating = 'Hard Coat';
      } else {
        coating = 'Anti-Reflective';
      }
    }

    const brand = item.lensBrand || item.lensCompany || null;
    const purchaseDate = inv?.billDate || (inv as any)?.createdAt || item.createdAt || new Date();
    const wholesalerOrderDate = item.wholesalerOrderDate ?? null;
    const sellPrice = typeof item.price === 'number' && item.price > 0 ? item.price : null;
    const costPerPair = typeof item.costPrice === 'number' && item.costPrice > 0 ? item.costPrice : null;
    const entryStatus: 'pending' | 'received' = costPerPair !== null && costPerPair > 0 ? 'received' : 'pending';

    const isBifocalOrProg = lensType === 'Bifocal' || lensType === 'Progressive';

    const reParsed = parseEyeNumberString(item.rightEyeNumber, isBifocalOrProg);
    const leParsed = parseEyeNumberString(item.leftEyeNumber, isBifocalOrProg);

    const hasExplicitRE = (item.rightSpherical !== undefined && item.rightSpherical !== null) ||
                          (item.rightCylinder !== undefined && item.rightCylinder !== null) ||
                          reParsed.sph !== null ||
                          Boolean(item.rightEyeNumber);

    const hasExplicitLE = (item.leftSpherical !== undefined && item.leftSpherical !== null) ||
                          (item.leftCylinder !== undefined && item.leftCylinder !== null) ||
                          leParsed.sph !== null ||
                          Boolean(item.leftEyeNumber);

    const isPair = (hasExplicitRE && hasExplicitLE) ||
                   item.isSameNumber === true ||
                   item.eye === 'both' ||
                   (item.eye !== 'left' && item.eye !== 'right' && (item.quantity === 1 || item.quantity === 2));

    if (isPair) {
      // Pair
      const reSph = item.rightSpherical ?? reParsed.sph ?? item.spherical ?? 0;
      const reCyl = item.rightCylinder ?? reParsed.cyl ?? item.cylinder ?? 0;
      const reAdd = item.rightAddition ?? reParsed.add ?? item.addition ?? null;

      const leSph = item.leftSpherical ?? leParsed.sph ?? item.spherical ?? 0;
      const leCyl = item.leftCylinder ?? leParsed.cyl ?? item.cylinder ?? 0;
      const leAdd = item.leftAddition ?? leParsed.add ?? item.addition ?? null;

      entriesToBatch.push({
        status: entryStatus,
        lensType,
        material,
        coating,
        color,
        brand,
        eye: 'right',
        sph: typeof reSph === 'number' ? reSph : 0,
        cyl: typeof reCyl === 'number' ? reCyl : 0,
        add: reAdd,
        qty: 1,
        unitCost: costPerPair !== null ? Math.round((costPerPair / 2) * 100) / 100 : null,
        costPerPair,
        unitSellPrice: sellPrice,
        supplier: 'Wholesale Lab',
        supplierInvoiceRef: invNumber,
        purchaseInvoiceId: invId,
        notes: `${customerName} (RE)`,
        purchaseDate,
        wholesalerOrderDate,
        importedFrom: `${itId}_re`,
        createdAt: purchaseDate,
        updatedAt: new Date(),
      });
      alreadyImported.add(`${itId}_re`);
      createdCount++;

      entriesToBatch.push({
        status: entryStatus,
        lensType,
        material,
        coating,
        color,
        brand,
        eye: 'left',
        sph: typeof leSph === 'number' ? leSph : 0,
        cyl: typeof leCyl === 'number' ? leCyl : 0,
        add: leAdd,
        qty: 1,
        unitCost: costPerPair !== null ? Math.round((costPerPair / 2) * 100) / 100 : null,
        costPerPair,
        unitSellPrice: sellPrice,
        supplier: 'Wholesale Lab',
        supplierInvoiceRef: invNumber,
        purchaseInvoiceId: invId,
        notes: `${customerName} (LE)`,
        purchaseDate,
        wholesalerOrderDate,
        importedFrom: `${itId}_le`,
        createdAt: purchaseDate,
        updatedAt: new Date(),
      });
      alreadyImported.add(`${itId}_le`);
      createdCount++;
    } else {
      const eye = item.eye === 'left' ? 'left' : item.eye === 'right' ? 'right' : (hasExplicitLE ? 'left' : hasExplicitRE ? 'right' : 'both');
      const parsed = eye === 'left' ? leParsed : reParsed;
      const sph = (eye === 'left'
        ? (item.leftSpherical ?? parsed.sph ?? item.spherical)
        : (item.rightSpherical ?? parsed.sph ?? item.spherical)) ?? item.spherical ?? 0;
      const cyl = (eye === 'left' ? (item.leftCylinder ?? parsed.cyl ?? item.cylinder) : (item.rightCylinder ?? parsed.cyl ?? item.cylinder)) ?? item.cylinder ?? 0;
      const add = (eye === 'left' ? (item.leftAddition ?? parsed.add ?? item.addition) : (item.rightAddition ?? parsed.add ?? item.addition)) ?? item.addition ?? null;

      const importedKey = item.prescription && (eye === 'right' || eye === 'left')
        ? `rx_${item.prescription}_${eye === 'right' ? 're' : 'le'}`
        : itId;

      entriesToBatch.push({
        status: entryStatus,
        lensType,
        material,
        coating,
        color,
        brand,
        eye,
        sph: typeof sph === 'number' ? sph : 0,
        cyl: typeof cyl === 'number' ? cyl : 0,
        add,
        qty: item.quantity || 1,
        unitCost: costPerPair !== null ? costPerPair : null,
        costPerPair,
        unitSellPrice: sellPrice,
        supplier: 'Wholesale Lab',
        supplierInvoiceRef: invNumber,
        purchaseInvoiceId: invId,
        notes: `${customerName}${eye !== 'both' ? ` (${eye === 'right' ? 'RE' : 'LE'})` : ''}`,
        purchaseDate,
        wholesalerOrderDate,
        importedFrom: importedKey,
        createdAt: purchaseDate,
        updatedAt: new Date(),
      });
      alreadyImported.add(importedKey);
      createdCount++;
    }
  }

  // 4. Batch insert into purchaseentries
  console.log(`Writing ${entriesToBatch.length} clean entries to Firestore in batches...`);
  const purchaseCol = db.collection('purchaseentries');
  for (let i = 0; i < entriesToBatch.length; i += 400) {
    const batch = db.batch();
    const chunk = entriesToBatch.slice(i, i + 400);
    for (const entry of chunk) {
      const docRef = purchaseCol.doc();
      batch.set(docRef, { ...entry, id: docRef.id, _id: docRef.id });
    }
    await batch.commit();
    console.log(`Committed batch ${i + 1} to ${i + chunk.length}`);
  }

  invalidateInvoiceLookupCache();

  // 5. Verification check
  const totalCount = await PurchaseEntry.countDocuments({});
  console.log(`\n=== RE-SYNC COMPLETE! ===`);
  console.log(`Total clean entries in purchaseentries: ${totalCount}`);

  // Check Amit
  const amitEntries = await PurchaseEntry.find({
    $or: [
      { notes: { $regex: 'Amit', $options: 'i' } },
      { supplierInvoiceRef: 'INV0665/26-27' },
    ],
  }).lean();
  console.log(`Amit entries in DB: ${amitEntries.length}`);
  for (const a of amitEntries) {
    console.log({
      id: a._id,
      importedFrom: a.importedFrom,
      notes: a.notes,
      supplierInvoiceRef: a.supplierInvoiceRef,
      lensType: a.lensType,
      specs: `${a.lensType} · ${a.material} · ${a.coating} · ${a.color}`,
      eye: a.eye,
      sph: a.sph,
      cyl: a.cyl,
      add: a.add,
      sellPrice: a.unitSellPrice,
      costPrice: a.costPerPair,
      status: a.status,
    });
  }
}

executeResync().catch(console.error);
