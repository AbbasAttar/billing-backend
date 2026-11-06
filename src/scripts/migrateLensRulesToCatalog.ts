/**
 * One-time: copy the old Lens Pricing Rules into the lens catalogue as the Local company
 * (owner decision, Nov 2026 — the rules page is retired; Settings → Lens Config → Local replaces it).
 *
 * Rules are only read, never changed or deleted. Mapping: src/services/lensRuleImport.ts.
 * Running it again skips Local coatings and products that already exist (by name), so it adds nothing twice.
 *
 *   npx ts-node --transpile-only src/scripts/migrateLensRulesToCatalog.ts           # dry run
 *   npx ts-node --transpile-only src/scripts/migrateLensRulesToCatalog.ts --apply   # write
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { LensPricing } from '../models/LensPricing.model';
import { BrandCoating, LensProduct } from '../models/LensCatalog.model';
import { LensCompany, LOCAL_COMPANY } from '../models/LensCompany.model';
import { planFromRules, type OldRule } from '../services/lensRuleImport';

const same = (a?: string | null, b?: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

async function run() {
  const apply = process.argv.includes('--apply');
  const rules = (await LensPricing.find().lean()) as unknown as OldRule[];

  const backupDir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `lenspricing-before-catalog-import-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(rules, null, 1));
  console.log(`Backup of ${rules.length} rules: ${backupFile}`);

  const plan = planFromRules(rules);
  const [existingCoatings, existingProducts, companies] = await Promise.all([
    BrandCoating.find().lean(),
    LensProduct.find().lean(),
    LensCompany.find().lean(),
  ]);

  if (!companies.some((c: any) => c.name === LOCAL_COMPANY)) {
    console.log(`${apply ? 'CREATE' : 'would create'} company ${LOCAL_COMPANY}`);
    if (apply) await LensCompany.create({ name: LOCAL_COMPANY, tier: 'essential', supplyType: 'wholesaler', active: true, supplier: null });
  }

  // Coating name → id (existing Local coatings are reused).
  const coatingId = new Map<string, string>();
  for (const c of existingCoatings as any[]) if (same(c.company, LOCAL_COMPANY)) coatingId.set(c.name.trim().toLowerCase(), String(c._id));
  for (const c of plan.coatings) {
    const key = c.name.toLowerCase();
    if (coatingId.has(key)) { console.log(`exists      coating ${c.name}`); continue; }
    console.log(`${apply ? 'CREATE' : 'would add'}   coating ${c.name}  [${c.features.join(', ')}]`);
    coatingId.set(key, apply ? String((await BrandCoating.create({ ...c, shortName: null, note: null }))._id) : `new:${key}`);
  }

  const productId = new Map<string, string>();
  let added = 0;
  // Base products first so variants can point at them.
  for (const p of [...plan.products].sort((a, b) => Number(Boolean(a.variantOfKey)) - Number(Boolean(b.variantOfKey)))) {
    const existing = (existingProducts as any[]).find((x) => same(x.company, LOCAL_COMPANY) && same(x.name, p.name));
    if (existing) { productId.set(p.key, String(existing._id)); console.log(`exists      product ${p.name}`); continue; }
    console.log(`${apply ? 'CREATE' : 'would add'}   product ${p.name} · ${p.lensType} · ${p.tier}${p.variantOfKey ? ' (variant)' : ''}`);
    for (const r of p.rows) {
      console.log(`              ${r.index.toFixed(2)} ${r.coating}  sph ${r.minSph}..${r.maxSph} cyl ${r.maxCyl}${r.minAdd != null ? ` add ${r.minAdd}..${r.maxAdd}` : ''}${r.dia ? ` dia ${r.dia}` : ''}  ₹${r.srp} (cost ₹${r.cost})`);
    }
    added++;
    if (!apply) continue;
    const { key, variantOfKey, rows, ...fields } = p;
    const created = await LensProduct.create({
      ...fields,
      variantOf: variantOfKey ? productId.get(variantOfKey) ?? null : null,
      rows: rows.map(({ coating, srp, cost, ...row }) => ({ ...row, prices: { [coatingId.get(coating.toLowerCase())!]: { srp, cost } } })),
    });
    productId.set(key, String(created._id));
  }

  console.log(`${apply ? 'Done' : 'Dry run'}: ${plan.coatings.length} coatings, ${added} new products from ${rules.length} rules.`);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
