/**
 * Rebuilds collection mirrors (`mirrors/*`) from source. Mirrors heal themselves, so this is only
 * for repair, e.g. after a script wrote documents without stamping `updatedAt`.
 *
 *   npx ts-node --transpile-only src/scripts/rebuildMirrors.ts                 # every mirrored collection
 *   npx ts-node --transpile-only src/scripts/rebuildMirrors.ts invoices frames  # just these
 */
import fs from 'node:fs';
import path from 'node:path';
import { mirroredCollections, rebuildMirror } from '../lib/collectionMirror';

async function run() {
  // Load every model so each registers its mirror.
  const modelsDir = path.join(__dirname, '..', 'models');
  for (const file of fs.readdirSync(modelsDir)) {
    if (/\.model\.(ts|js)$/.test(file)) await import(path.join(modelsDir, file));
  }

  const wanted = process.argv.slice(2);
  const targets = wanted.length ? wanted : mirroredCollections();
  for (const col of targets) {
    if (!mirroredCollections().includes(col)) {
      console.warn(`[mirror] "${col}" is not a mirrored collection; skipped`);
      continue;
    }
    const count = await rebuildMirror(col);
    console.log(`[mirror] ${col}: ${count} docs`);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[mirror] rebuild failed:', err);
    process.exit(1);
  });
