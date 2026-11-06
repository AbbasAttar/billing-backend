/**
 * One-time: make every LensPricing price per PAIR (owner decision, Nov 2026).
 *
 * Rules entered by hand before the Enterprise import (no `wholesaler`) were per LENS — invoices
 * show them billed at 2× for both eyes. This doubles their price and costPrice and stamps
 * `priceUnit: 'pair'` on every rule, so running it again changes nothing.
 *
 * Run ONLY together with the deploy that ships per-pair code (backend + admin), otherwise the
 * old billing code would charge doubled prices.
 *
 *   npx ts-node --transpile-only src/scripts/migrateLensPricingPerPair.ts           # dry run
 *   npx ts-node --transpile-only src/scripts/migrateLensPricingPerPair.ts --apply   # write
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { LensPricing } from '../models/LensPricing.model';

async function run() {
  const apply = process.argv.includes('--apply');
  const rules: any[] = await LensPricing.find().lean();

  const backupDir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `lenspricing-before-per-pair-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(rules, null, 1));
  console.log(`Backup of ${rules.length} rules: ${backupFile}`);

  let doubled = 0;
  let stamped = 0;
  for (const r of rules) {
    if (r.priceUnit === 'pair') continue;
    const perLens = !r.wholesaler;
    const label = `${r.lensType} · ${r.coating} · ${r.color} · sph ${r.minSph}..${r.maxSph} cyl ${r.minCyl}..${r.maxCyl}`;
    if (perLens) {
      console.log(`${apply ? 'DOUBLE' : 'would double'}  ${label}   sell ${r.price} → ${r.price * 2}, cost ${r.costPrice} → ${r.costPrice * 2}`);
    }
    if (!apply) { perLens ? doubled++ : stamped++; continue; }

    const doc = await LensPricing.findById(r._id);
    if (!doc) continue;
    if (perLens) {
      doc.price = r.price * 2;
      doc.costPrice = r.costPrice * 2;
      doubled++;
    } else {
      stamped++;
    }
    doc.priceUnit = 'pair';
    await doc.save();
  }
  console.log(`${apply ? 'Done' : 'Dry run'}: ${doubled} per-lens rules doubled, ${stamped} already-per-pair rules stamped.`);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
