/**
 * One-time: designs and tint colours become shared lists with brand names (aliases), Nov 2026.
 *
 * - A per-company design / tint colour that matches a shared one by name is removed (the shared one covers it).
 * - Any other per-company entry becomes shared (company cleared) and is listed, so the owner can rename it
 *   to the shared design / colour and add the company's own name as a brand name instead.
 * - Adds the shared designs (Near Comfort, Wide Corridor, Digital, 4K, 8K, AI…) that are missing,
 *   and fills in what-it-is / best-for / level on default designs that have none.
 *
 * Writes a backup of all lens options first. Running it again changes nothing.
 *
 *   npx ts-node --transpile-only src/scripts/migrateLensOptionBrands.ts           # dry run
 *   npx ts-node --transpile-only src/scripts/migrateLensOptionBrands.ts --apply   # write
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { LensOption } from '../models/LensOption.model';
import { DEFAULT_DESIGNS } from '../controllers/lensOption.controller';

const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

async function run() {
  const apply = process.argv.includes('--apply');
  const all: any[] = await LensOption.find().lean();

  const backupDir = path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `lensoptions-before-brands-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(all, null, 1));
  console.log(`Backup of ${all.length} lens options: ${backupFile}`);

  const shared = (o: any) => !o.company;
  const sameEntry = (a: any, b: any) => a.kind === b.kind && lower(a.parent) === lower(b.parent) && lower(a.name) === lower(b.name);
  let removed = 0;
  let madeShared = 0;

  // 1. Per-company designs and tint colours
  for (const o of all.filter((x) => (x.kind === 'design' || x.kind === 'tintColor') && x.company)) {
    const label = `${o.kind} · ${o.parent ? `${o.parent} · ` : ''}${o.name} (${o.company})`;
    if (all.some((x) => shared(x) && sameEntry(x, o))) {
      console.log(`${apply ? 'REMOVE' : 'would remove'}  ${label} — the shared entry covers it`);
      if (apply) await LensOption.findByIdAndDelete(o._id);
      removed++;
    } else {
      console.log(`${apply ? 'SHARE' : 'would share'}   ${label} — rename it to a shared design/colour and add "${o.name}" as ${o.company}'s brand name if it is one`);
      if (apply) await LensOption.findByIdAndUpdate(o._id, { $set: { company: null } });
      madeShared++;
    }
  }

  // 2. Shared designs and their descriptions
  let added = 0;
  let described = 0;
  for (const seed of DEFAULT_DESIGNS) {
    const existing = all.find((x) => x.kind === 'design' && shared(x) && sameEntry(x, { kind: 'design', ...seed }));
    if (!existing) {
      console.log(`${apply ? 'ADD' : 'would add'}     design · ${seed.parent} · ${seed.name}`);
      if (apply) await LensOption.create({ kind: 'design', shortName: '', aliases: [], ...seed });
      added++;
    } else if (!existing.description) {
      console.log(`${apply ? 'DESCRIBE' : 'would describe'} design · ${seed.parent} · ${seed.name}`);
      if (apply) {
        await LensOption.findByIdAndUpdate(existing._id, {
          $set: { description: seed.description, bestFor: seed.bestFor ?? [], level: seed.level ?? null },
        });
      }
      described++;
    }
  }

  console.log(
    `\n${apply ? 'Done' : 'Dry run'}: ${removed} duplicates removed, ${madeShared} per-company entries made shared, ` +
      `${added} shared designs added, ${described} designs described.`,
  );
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
