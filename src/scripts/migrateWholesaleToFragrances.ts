/**
 * One-time move of wholesale items into the fragrance catalogue (catalogue merge, phase 2).
 *
 *   npx tsx src/scripts/migrateWholesaleToFragrances.ts           # dry run: prints what would happen
 *   npx tsx src/scripts/migrateWholesaleToFragrances.ts --apply   # does it
 *
 * Each wholesale item becomes a fragrance record ticked Wholesale + Raw material (not Retail), with the
 * same stock (in its own unit), cost, wholesale price, alert level and order state. Items from the
 * "Bottle" company become Packaging. The old item is kept and gets `migratedTo`, so bills made before
 * the move still find it and put stock back on the new record. Already-moved items are skipped, so the
 * script can be run again safely. Nothing is deleted.
 */
import 'dotenv/config';
import '../config/timezone';
import { WholesaleItem } from '../models/WholesaleItem.model';
import { Fragrance } from '../models/Fragrance.model';

const APPLY = process.argv.includes('--apply');

export function fragranceFromWholesale(w: any) {
  const company = (w.companyName ?? '').trim();
  const unit = (w.unit ?? 'bottle').trim() || 'bottle';
  const isPackaging = company.toLowerCase() === 'bottle' && !/water/i.test(w.name ?? '');
  return {
    name: String(w.name ?? '').trim(),
    companyName: company,
    companyId: w.companyId ?? null,
    type: isPackaging ? 'packaging' : /water/i.test(w.name ?? '') ? 'essence' : 'attar',
    unit,
    channels: { retail: false, wholesale: true, rawMaterial: true },
    costPrice: typeof w.costPrice === 'number' ? w.costPrice : 0,
    sellPrice: 0,
    stock: typeof w.stock === 'number' ? w.stock : 0,
    wholesale: { price: typeof w.sellPrice === 'number' ? w.sellPrice : 0, unit: `per ${unit}` },
    ws: {
      reorderLevel: w.reorderLevel ?? null,
      inOrderQueue: !!w.inOrderQueue,
      queueQty: w.queueQty ?? null,
      isOrdered: !!w.isOrdered,
      orderedQty: w.orderedQty ?? null,
      orderedAt: w.orderedAt ?? null,
    },
    notes: w.notes ?? '',
    variants: [],
    isArchived: !!w.isArchived,
    ...(w.isArchived ? { archivedAt: w.archivedAt ?? new Date() } : {}),
    legacyWholesaleId: String(w._id),
  };
}

async function main() {
  const items: any[] = await WholesaleItem.find({}).lean();
  const todo = items.filter((w) => !w.migratedTo);
  console.log(`${items.length} wholesale items, ${items.length - todo.length} already moved, ${todo.length} to move.`);
  const byType = new Map<string, number>();
  for (const w of todo) {
    const f = fragranceFromWholesale(w);
    byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
  }
  console.log('As types:', Object.fromEntries(byType));
  for (const w of todo.slice(0, 8)) {
    const f = fragranceFromWholesale(w);
    console.log(`  ${f.name} (${f.companyName}) → ${f.type}, ${f.stock} ${f.unit}, cost ${f.costPrice}, wholesale ₹${f.wholesale.price} ${f.wholesale.unit}${f.ws.isOrdered ? `, ordered ${f.ws.orderedQty}` : ''}${f.isArchived ? ', archived' : ''}`);
  }
  if (!APPLY) {
    console.log('\nDry run — nothing written. Add --apply to move them.');
    return;
  }
  let moved = 0;
  for (const w of todo) {
    const created: any = await Fragrance.create(fragranceFromWholesale(w) as any);
    await WholesaleItem.findByIdAndUpdate(String(w._id), { migratedTo: String(created._id ?? created.id) });
    moved += 1;
  }
  console.log(`Moved ${moved} items.`);
}

if (require.main === module) {
  main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
