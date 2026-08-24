/**
 * One-time import: creates PurchaseEntry records from historical lens InvoiceItems.
 * Splits eye='both' items into RE + LE entries with half the price each.
 * Uses invoice selling price / qty as costPerPair proxy.
 * Idempotent — skips items already imported via importedFrom field.
 *
 * Run with:  npx ts-node src/scripts/backfillInvoicesToPurchases.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { InvoiceItem } from '../models/InvoiceItem.model';
import { PurchaseEntry } from '../models/PurchaseEntry.model';
import { LENS_TYPES, LENS_MATERIALS, LENS_COLORS } from '../models/LensPricing.model';

const VALID_TYPES     = new Set<string>(LENS_TYPES);
const VALID_MATERIALS = new Set<string>(LENS_MATERIALS);
const VALID_COLORS    = new Set<string>(LENS_COLORS);

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/billing_system';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  // Find all lens InvoiceItems with valid enum values
  const items = await InvoiceItem.find({
    lensType:     { $exists: true, $ne: null },
    lensMaterial: { $exists: true, $ne: null },
    lensColor:    { $exists: true, $ne: null },
    lensCoating:  { $exists: true, $ne: null },
  }).lean();

  console.log(`Found ${items.length} lens InvoiceItems`);

  // Diagnostic: show distinct field values
  const distinctTypes     = [...new Set(items.map(i => i.lensType))];
  const distinctMaterials = [...new Set(items.map(i => i.lensMaterial))];
  const distinctColors    = [...new Set(items.map(i => i.lensColor))];
  const distinctCoatings  = [...new Set(items.map(i => i.lensCoating))];
  console.log('lensType values:   ', JSON.stringify(distinctTypes));
  console.log('lensMaterial values:', JSON.stringify(distinctMaterials));
  console.log('lensColor values:  ', JSON.stringify(distinctColors));
  console.log('lensCoating values:', JSON.stringify(distinctCoatings));

  // Find already-imported IDs to stay idempotent
  const alreadyImported = new Set(
    (await PurchaseEntry.distinct('importedFrom', { importedFrom: { $ne: null } })).map(String)
  );
  console.log(`Already imported: ${alreadyImported.size} items`);

  let created = 0;
  let skipped = 0;
  let invalid = 0;

  for (const item of items) {
    const id = String(item._id);

    if (alreadyImported.has(id)) { skipped++; continue; }

    const lensType  = item.lensType  ?? '';
    const material  = item.lensMaterial ?? '';
    const color     = item.lensColor ?? '';
    const coating   = item.lensCoating ?? '';

    if (!VALID_TYPES.has(lensType) || !VALID_MATERIALS.has(material) || !VALID_COLORS.has(color) || !coating.trim()) {
      invalid++;
      continue;
    }

    const eye      = item.eye ?? 'both';
    const qty      = item.quantity || 1;
    const price    = item.price || 0;

    // Build entries to create
    type EyeEntry = { eye: 'right' | 'left'; sph: number; cyl: number; add: number | null; cost: number };
    const entries: EyeEntry[] = [];

    if (eye === 'right') {
      entries.push({
        eye:  'right',
        sph:  item.rightSpherical ?? item.spherical ?? 0,
        cyl:  item.rightCylinder  ?? item.cylinder  ?? 0,
        add:  item.rightAddition  ?? item.addition  ?? null,
        cost: price / qty,
      });
    } else if (eye === 'left') {
      entries.push({
        eye:  'left',
        sph:  item.leftSpherical ?? item.spherical ?? 0,
        cyl:  item.leftCylinder  ?? item.cylinder  ?? 0,
        add:  item.leftAddition  ?? item.addition  ?? null,
        cost: price / qty,
      });
    } else {
      // both — split price equally per eye
      const halfCost = price / qty / 2;
      entries.push({
        eye:  'right',
        sph:  item.rightSpherical ?? item.spherical ?? 0,
        cyl:  item.rightCylinder  ?? item.cylinder  ?? 0,
        add:  item.rightAddition  ?? item.addition  ?? null,
        cost: halfCost,
      });
      entries.push({
        eye:  'left',
        sph:  item.leftSpherical ?? item.spherical ?? 0,
        cyl:  item.leftCylinder  ?? item.cylinder  ?? 0,
        add:  item.leftAddition  ?? item.addition  ?? null,
        cost: halfCost,
      });
    }

    for (const e of entries) {
      await PurchaseEntry.create({
        lensType,
        material,
        coating:      coating.trim(),
        color,
        eye:          e.eye,
        sph:          e.sph,
        cyl:          e.cyl,
        add:          e.add,
        qty,
        costPerPair:  Math.round(e.cost * 100) / 100,
        importedFrom: id,
        notes:        'imported from invoice',
        purchaseDate: (item as any).createdAt ?? new Date(),
      });
      created++;
    }
  }

  console.log(`Done — created: ${created}, skipped (already done): ${skipped}, invalid (bad enum): ${invalid}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
