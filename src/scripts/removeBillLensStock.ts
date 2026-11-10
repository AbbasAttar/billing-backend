/**
 * Takes lenses that were ordered for customer bills back out of `lensstocks`.
 *
 * Until the fix, receiving a purchase entry made from a bill (purchaseentries.importedFrom set) added
 * those lenses to shelf stock, although they were fitted for the customer. Every row such a receipt
 * touched carries `lastCost`. For each of those rows:
 *   billLenses = lenses received from bills for that exact lens + power (eye 'both' = 2 per qty)
 *   left       = row quantity (missing = 0) − billLenses
 *   left <= 0  → the row is deleted (it only held bill lenses)
 *   left  > 0  → quantity set to `left` (lenses added by hand stay)
 * Rows without `lastCost` were never touched by a receipt and are left alone. Purchase entries and
 * invoices are NOT changed, so purchase history and sales analytics keep every record.
 * A JSON backup of every touched row is written before anything changes.
 *
 * Rows it reduces get `billStockCleaned: true` and are skipped on later runs, so running it twice is safe.
 * `--mark-done` only sets that flag on every remaining `lastCost` row (used once after the first run).
 *
 * Defaults to a DRY RUN.
 *   npx ts-node --transpile-only src/scripts/removeBillLensStock.ts
 *   npx ts-node --transpile-only src/scripts/removeBillLensStock.ts --apply
 */
import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/firestoreDb';
import { LensStock } from '../models/LensStock.model';

const apply = process.argv.includes('--apply');
const markDone = process.argv.includes('--mark-done');
const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const t = (v: unknown) => String(v ?? '').trim().toLowerCase();
const addOf = (v: unknown) => (typeof v === 'number' && v > 0 ? n2(v) : '');
const key = (r: any) => [t(r.lensType), t(r.material), t(r.coating), t(r.color), n2(r.sph), n2(r.cyl), addOf(r.add)].join('|');

async function run() {
  console.log(`[bill-stock] mode=${apply ? 'APPLY' : 'DRY RUN'}`);
  const db = getDb();
  const [stockSnap, peSnap] = await Promise.all([db.collection('lensstocks').get(), db.collection('purchaseentries').get()]);

  const billLenses = new Map<string, number>();
  for (const d of peSnap.docs) {
    const p = d.data();
    if (!p.importedFrom || p.status !== 'received' || !p.lensType) continue;
    const lenses = (Number(p.qty) || 0) * (p.eye === 'both' ? 2 : 1);
    billLenses.set(key(p), (billLenses.get(key(p)) ?? 0) + lenses);
  }

  const toDelete: any[] = [];
  const toReduce: { row: any; left: number }[] = [];
  let untouched = 0;
  for (const d of stockSnap.docs) {
    const r = { id: d.id, ...d.data() } as any;
    if (!('lastCost' in r) || r.billStockCleaned) { untouched++; continue; }
    const qty = typeof r.quantity === 'number' ? r.quantity : 0;
    const left = qty - (billLenses.get(key(r)) ?? 0);
    if (left <= 0) toDelete.push(r);
    else toReduce.push({ row: r, left });
  }

  const pieces = (rows: any[]) => rows.reduce((s, r) => s + (typeof r.quantity === 'number' ? r.quantity : 0), 0);
  console.log(`[bill-stock] rows=${stockSnap.size} skipped=${untouched} delete=${toDelete.length} (pieces ${pieces(toDelete)}) reduce=${toReduce.length}`);
  for (const x of toReduce) {
    console.log(`  keep ${x.row.lensType} ${x.row.material}/${x.row.coating}/${x.row.color} sph ${x.row.sph} cyl ${x.row.cyl} add ${x.row.add ?? '-'}: ${x.row.quantity} -> ${x.left}`);
  }
  if (markDone) {
    for (const x of toReduce) await LensStock.findByIdAndUpdate(x.row.id, { billStockCleaned: true });
    for (const r of toDelete) await LensStock.findByIdAndUpdate(r.id, { billStockCleaned: true });
    console.log(`[bill-stock] marked ${toReduce.length + toDelete.length} rows as already cleaned`);
    return;
  }
  if (!apply) return;

  const backup = path.join(process.cwd(), `lensstocks-bill-removal-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify([...toDelete, ...toReduce.map((x) => x.row)], null, 1));
  console.log(`[bill-stock] backup written: ${backup}`);

  // Through the model so the lensstocks mirror stays in step.
  for (const r of toDelete) await LensStock.findByIdAndDelete(r.id);
  for (const x of toReduce) await LensStock.findByIdAndUpdate(x.row.id, { quantity: x.left, billStockCleaned: true });
  console.log(`[bill-stock] done: deleted ${toDelete.length}, reduced ${toReduce.length}`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
