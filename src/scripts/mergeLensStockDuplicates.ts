/**
 * Folds `lensstocks` rows for the same lens + power (type, material, coating, tint, SPH, CYL, ADD — names
 * compared case-insensitively, ADD 0 = none) into the oldest row, the same rule as
 * POST /lens-stock/merge-duplicates:
 *   quantity     = sum of the rows' quantities (missing counts as 0; left missing if no row has one)
 *   reorderLevel = highest of the rows
 *   costPrice    = from the most recently updated row with a cost > 0
 * The other rows are deleted. A JSON backup of every touched row is written before anything changes.
 *
 * Defaults to a DRY RUN.
 *   npx ts-node --transpile-only src/scripts/mergeLensStockDuplicates.ts
 *   npx ts-node --transpile-only src/scripts/mergeLensStockDuplicates.ts --apply
 */
import fs from 'fs';
import path from 'path';
import { getDb, snapToData } from '../lib/firestoreDb';
import { stockKey } from '../controllers/lensStock.controller';
import { LensStock } from '../models/LensStock.model';

const apply = process.argv.includes('--apply');
const time = (d: any) => (d?.toDate ? d.toDate().getTime() : d ? new Date(d).getTime() : 0);
const qty = (r: any) => (Number.isFinite(r.quantity) ? Math.max(0, r.quantity) : 0);

async function run() {
  console.log(`[merge] mode=${apply ? 'APPLY' : 'DRY RUN'}`);
  const db = getDb();
  const snap = await db.collection('lensstocks').get();
  const rows = snap.docs.map((d) => ({ ...snapToData(d), _id: d.id, _ref: d.ref, _raw: d.data() })) as any[];

  const groups = new Map<string, any[]>();
  for (const r of rows) groups.set(stockKey(r), [...(groups.get(stockKey(r)) ?? []), r]);
  const dupes = [...groups.values()].filter((g) => g.length > 1);

  let removed = 0;
  let skipped = 0;
  const plan: any[] = [];
  for (const g of dupes) {
    if (g.some((r) => ['$inc', '$set', '$setOnInsert'].some((k) => k in r._raw))) { skipped++; continue; }
    g.sort((a, b) => time(a.createdAt) - time(b.createdAt));
    const [keep, ...extra] = g;
    const latestCost = [...g].sort((a, b) => time(b.updatedAt) - time(a.updatedAt)).find((r) => (r.costPrice ?? 0) > 0);
    const update: Record<string, number> = {
      reorderLevel: Math.max(...g.map((r) => r.reorderLevel ?? 0)),
      costPrice: latestCost?.costPrice ?? keep.costPrice ?? 0,
    };
    // Leave quantity unset when none of the rows was ever counted, so the row stays "not counted".
    if (g.some((r) => Number.isFinite(r.quantity))) update.quantity = g.reduce((s, r) => s + qty(r), 0);
    plan.push({ keep, extra, update });
    removed += extra.length;
  }

  console.log(`[merge] rows=${rows.length} duplicateLenses=${dupes.length} toMerge=${plan.length} rowsToDelete=${removed} skipped=${skipped}`);
  for (const p of plan.slice(0, 12)) {
    console.log(`  ${p.keep.lensType} ${p.keep.material}/${p.keep.coating}/${p.keep.color} sph ${p.keep.sph} cyl ${p.keep.cyl} add ${p.keep.add ?? '-'}: ` +
      `${p.extra.length + 1} rows, qty [${[p.keep, ...p.extra].map((r: any) => r.quantity ?? '?').join(', ')}] -> ${p.update.quantity ?? '?'}`);
  }
  if (!apply) return;

  const backup = path.join(process.cwd(), `lensstocks-merge-backup-${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(plan.flatMap((p) => [p.keep, ...p.extra]).map((r) => ({ id: r._id, ...r._raw })), null, 1));
  console.log(`[merge] backup written: ${backup}`);

  // Through the model so the lensstocks mirror stays in step.
  for (const p of plan) {
    await LensStock.findByIdAndUpdate(p.keep._id, p.update);
    for (const r of p.extra) await LensStock.findByIdAndDelete(r._id);
  }
  console.log(`[merge] done: merged ${plan.length} lenses, deleted ${removed} rows`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
