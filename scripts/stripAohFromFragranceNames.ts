/**
 * Remove the "AOH" word from fragrance names (AOH is the company, so bills showed "AOH AOH ...").
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/stripAohFromFragranceNames.ts          # dry run
 *   npx ts-node --transpile-only scripts/stripAohFromFragranceNames.ts --apply  # write
 */
import 'dotenv/config';
import { Fragrance } from '../src/models/Fragrance.model';

const APPLY = process.argv.includes('--apply');

function strip(name: string): string {
  return name
    .replace(/\bAOH\b/gi, ' ')
    .replace(/\s*[-–|:]\s*$/, '')
    .replace(/^\s*[-–|:]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function main() {
  const all: any[] = await (Fragrance.find({}) as any).lean();
  const hits = all.filter((f) => /\bAOH\b/i.test(f.name ?? ''));
  console.log(`${all.length} fragrances, ${hits.length} with AOH in name`);
  for (const f of hits) {
    const next = strip(f.name);
    console.log(`${f._id} | company="${f.companyName}" | "${f.name}" -> "${next}"`);
    if (APPLY && next && next !== f.name) {
      await Fragrance.findByIdAndUpdate(f._id, { $set: { name: next } });
    }
  }
  console.log(APPLY ? 'Applied.' : 'Dry run. Pass --apply to write.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
