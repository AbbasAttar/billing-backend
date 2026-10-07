/**
 * Repairs `lensstocks` docs written by the old upsert bug, which stored the update operators as
 * literal fields ({ "$inc": { quantity: 1 }, "$set": { costPrice }, "$setOnInsert": { reorderLevel } })
 * instead of applying them. Each doc is rewritten in place with what the upsert meant:
 *   quantity      = existing numeric quantity (or 0) + $inc.quantity
 *   other fields  = $set values, then $setOnInsert values where the field is still missing
 * The operator keys are removed and updatedAt is stamped. Nothing is deleted; duplicate
 * combinations are only reported.
 *
 * Defaults to a DRY RUN.
 *   npx ts-node --transpile-only src/scripts/repairLensStockOperators.ts
 *   npx ts-node --transpile-only src/scripts/repairLensStockOperators.ts --apply
 */
import { getDb } from '../lib/firestoreDb';

const apply = process.argv.includes('--apply');
const OPS = ['$inc', '$set', '$setOnInsert'];

async function run() {
  console.log(`[repair] mode=${apply ? 'APPLY' : 'DRY RUN'}`);
  const db = getDb();
  const snap = await db.collection('lensstocks').get();

  const repairs: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }> = [];
  for (const doc of snap.docs) {
    const raw = doc.data();
    if (!OPS.some((op) => op in raw)) continue;

    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) if (!k.startsWith('$')) clean[k] = v;

    for (const [k, v] of Object.entries(raw.$set ?? {})) clean[k] = v;
    for (const [k, v] of Object.entries(raw.$setOnInsert ?? {})) if (clean[k] === undefined) clean[k] = v;
    for (const [k, v] of Object.entries(raw.$inc ?? {})) {
      const base = typeof clean[k] === 'number' ? clean[k] : 0;
      clean[k] = base + (Number(v) || 0);
    }
    if (typeof clean.quantity !== 'number') clean.quantity = 0;
    clean.updatedAt = new Date();
    repairs.push({ ref: doc.ref, data: clean });
  }

  const qty = repairs.reduce((s, r) => s + r.data.quantity, 0);
  const combo = (d: any) => [d.lensType, d.material, d.coating ?? null, d.color ?? null, d.sph, d.cyl, d.add ?? null].join('|');
  const counts = new Map<string, number>();
  for (const d of snap.docs) counts.set(combo(d.data()), (counts.get(combo(d.data())) ?? 0) + 1);
  const dupCombos = [...counts.values()].filter((n) => n > 1).length;

  console.log(`[repair] scanned=${snap.size} ${apply ? 'repaired' : 'wouldRepair'}=${repairs.length} totalQuantityRestored=${qty}`);
  console.log(`[repair] sample: ${JSON.stringify(repairs.slice(0, 2).map((r) => ({ id: r.ref.id, quantity: r.data.quantity, costPrice: r.data.costPrice, reorderLevel: r.data.reorderLevel })))}`);
  console.log(`[repair] duplicate stock combinations (not changed): ${dupCombos}`);

  if (apply) {
    for (let i = 0; i < repairs.length; i += 400) {
      const batch = db.batch();
      for (const r of repairs.slice(i, i + 400)) batch.set(r.ref, r.data);
      await batch.commit();
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[repair] failed:', err);
    process.exit(1);
  });
