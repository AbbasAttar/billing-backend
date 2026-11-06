/**
 * One-time: lens companies for price book v2 (docs/lens-price-book-v2-plan.md).
 *
 * - Creates a LensCompany for 'Local' and for every wholesaler named on a rule.
 * - Stamps `company` on rules that have none: their wholesaler, else Local (same rule the
 *   resolver already applies, so prices do not change).
 * - Lists single-power rules (min = max) that purchase entries created — report only.
 *
 * Writes a backup of all rules first. Running it again changes nothing.
 *
 *   npx ts-node --transpile-only src/scripts/migrateLensCompanies.ts           # dry run
 *   npx ts-node --transpile-only src/scripts/migrateLensCompanies.ts --apply   # write
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { LensPricing } from '../models/LensPricing.model';
import { LensCompany, LOCAL_COMPANY } from '../models/LensCompany.model';
import { ruleCompany } from '../services/lensPriceResolver';

async function run() {
  const apply = process.argv.includes('--apply');
  const rules: any[] = await LensPricing.find().lean();
  const companies: any[] = await LensCompany.find().lean();

  const backupDir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `lenspricing-before-companies-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(rules, null, 1));
  console.log(`Backup of ${rules.length} rules: ${backupFile}`);

  // 1. Companies
  const have = new Set(companies.map((c) => String(c.name).toLowerCase()));
  const wanted = new Set<string>([LOCAL_COMPANY, ...rules.map((r) => ruleCompany(r))]);
  let created = 0;
  for (const name of wanted) {
    if (have.has(name.toLowerCase())) continue;
    console.log(`${apply ? 'CREATE' : 'would create'}  company ${name}`);
    // Supplier is picked later on Lens Config (wholesaler vendor or direct).
    if (apply) await LensCompany.create({ name, tier: 'essential', supplyType: 'wholesaler', active: true, supplier: null });
    created++;
  }

  // 2. Stamp company on rules
  const counts = new Map<string, number>();
  let stamped = 0;
  for (const r of rules) {
    if (r.company) continue;
    const name = ruleCompany(r);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    stamped++;
    if (!apply) continue;
    const doc = await LensPricing.findById(r._id);
    if (!doc) continue;
    doc.company = name;
    await doc.save();
  }
  for (const [name, n] of counts) console.log(`${apply ? 'STAMP' : 'would stamp'}  ${n} rules → ${name}`);

  // 3. Single-power rules — report only
  const point = rules.filter((r) => r.minSph === r.maxSph && r.minCyl === r.maxCyl);
  if (point.length) {
    console.log(`\n${point.length} single-power rules (min = max), probably created from purchase entries:`);
    for (const r of point) {
      console.log(`  ${ruleCompany(r)} · ${r.lensType} · ${r.material} · ${r.coating} · ${r.color} · sph ${r.minSph} cyl ${r.minCyl}${r.minAdd != null ? ` add ${r.minAdd}` : ''}  sell ${r.price} cost ${r.costPrice}`);
    }
  }

  console.log(`\n${apply ? 'Done' : 'Dry run'}: ${created} companies created, ${stamped} rules stamped, ${point.length} single-power rules listed.`);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
