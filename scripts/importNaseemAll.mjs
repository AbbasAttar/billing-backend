/**
 * Import ALL Naseem collections from products.csv + local images.
 *
 * Usage:
 *   node scripts/importNaseemAll.mjs [--dry-run] [--collection="Classic Collection"]
 *
 * Already-imported slugs are detected and skipped automatically.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { GoogleAuth } from 'google-auth-library';

// ─── Config ──────────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = 'C:/Users/abbas/Downloads/attarwala-46200-adb62f5d6391.json';
const SCRAPER_DIR          = 'C:/Users/abbas/Downloads/naseem-scraper';
const CSV_FILE             = join(SCRAPER_DIR, 'products.csv');
const API_BASE             = 'http://localhost:3001/api';
const BUCKET               = 'attarwala-46200.firebasestorage.app';

const args            = process.argv.slice(2);
const DRY_RUN         = args.includes('--dry-run');
const collectionArg   = args.find(a => a.startsWith('--collection='));
const ONLY_COLLECTION = collectionArg ? collectionArg.split('=').slice(1).join('=') : null;

// Map fragrance_family values from CSV → tags / fragranceFamily array
function toFamilyArray(raw) {
  if (!raw) return ['Oriental'];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Derive a kebab-case tag from the collection name e.g. "Classic Collection" → "classic-collection"
function collectionTag(name) {
  return name.toLowerCase().replace(/\s+/g, '-');
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(filepath) {
  const lines = readFileSync(filepath, 'utf-8').trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = [];
    let cell = '', inQuotes = false;
    for (const ch of line) {
      if (ch === '"')            { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { values.push(cell.trim()); cell = ''; }
      else                       { cell += ch; }
    }
    values.push(cell.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

// ─── Firebase Storage ─────────────────────────────────────────────────────────
async function getAccessToken() {
  const auth = new GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

async function uploadImage(token, localPath, storagePath) {
  const data    = readFileSync(localPath);
  const encoded = encodeURIComponent(storagePath);
  const url     = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encoded}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: data,
  });
  if (!res.ok) throw new Error(`Upload ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encoded}?alt=media&token=${json.downloadTokens}`;
}

// ─── Backend API ──────────────────────────────────────────────────────────────
async function slugExists(slug) {
  try {
    const res  = await fetch(`${API_BASE}/fragrances?q=${encodeURIComponent(slug)}`);
    const list = await res.json();
    return Array.isArray(list) && list.some(f => f.web?.slug === slug);
  } catch { return false; }
}

async function createFragrance(payload) {
  const res = await fetch(`${API_BASE}/fragrances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Create ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const modeLabel = DRY_RUN ? '🔍  DRY RUN' : '🚀  Importing';
  const filterLabel = ONLY_COLLECTION ? ` [${ONLY_COLLECTION}]` : ' [All collections]';
  console.log(`\n${modeLabel}${filterLabel}\n`);

  const all      = parseCSV(CSV_FILE);
  const products = all.filter(p =>
    p.status === 'active' &&
    (!ONLY_COLLECTION || p.collection === ONLY_COLLECTION)
  );

  // Group by collection for a nice summary
  const byCollection = {};
  for (const p of products) {
    byCollection[p.collection] = (byCollection[p.collection] || 0) + 1;
  }
  for (const [col, count] of Object.entries(byCollection)) {
    console.log(`  ${col}: ${count} products`);
  }
  console.log(`  ────────────────`);
  console.log(`  Total: ${products.length} products\n`);

  const token = DRY_RUN ? null : await getAccessToken();
  let ok = 0, skipped = 0, failed = 0;

  for (const row of products) {
    // image_file is like "images/classic-collection/lamsa-80ml.jpg"
    const relImagePath = row.image_file;                        // e.g. images/classic-collection/lamsa-80ml.jpg
    const localImage   = join(SCRAPER_DIR, relImagePath);      // absolute local path
    const storagePath  = `naseem/${relImagePath.replace('images/', '')}`; // naseem/classic-collection/lamsa-80ml.jpg
    const slug         = `naseem-${row.slug}`;
    const displayName  = `Naseem ${row.product_name} ${row.size_ml}ml`;
    const colTag       = collectionTag(row.collection);

    console.log(`▶  ${displayName}  [${row.collection}]`);
    console.log(`   slug: ${slug}`);

    if (!existsSync(localImage)) {
      console.warn(`   ⚠  Image missing: ${localImage} — skipping\n`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`   [DRY RUN] OK\n`);
      continue;
    }

    if (await slugExists(slug)) {
      console.log(`   ⏩  Already imported — skipping\n`);
      skipped++;
      continue;
    }

    try {
      const imageUrl = await uploadImage(token, localImage, storagePath);
      console.log(`   ✓  Image uploaded`);

      const fragranceFamily = toFamilyArray(row.fragrance_family);

      const payload = {
        type: 'perfume',
        companyName: 'Naseem',
        name: row.product_name,
        sellPrice: row.price_inr ? Number(row.price_inr) : 0,
        stock: 10,
        web: {
          isPublished: true,
          slug,
          displayName,
          shortDescription: row.description,
          images: [{ url: imageUrl, alt: displayName, isPrimary: true, order: 0 }],
          tags: [
            'naseem',
            colTag,
            'perfume',
            `${row.size_ml}ml`,
            row.product_name.toLowerCase(),
            ...fragranceFamily.map(f => f.toLowerCase()),
          ],
          fragranceFamily,
          gender: row.gender || 'unisex',
          longevity: 'Strong',
          publishedAt: new Date().toISOString(),
          seo: {
            title: `${displayName} — Buy Online | Attarwala Optical House`,
            description: row.description,
            keywords: [
              'naseem perfume',
              row.product_name.toLowerCase(),
              'oriental perfume india',
              'buy naseem online',
              `naseem ${row.product_name.toLowerCase()}`,
            ],
          },
        },
      };

      await createFragrance(payload);
      console.log(`   ✓  Record created\n`);
      ok++;
    } catch (err) {
      console.error(`   ✗  ${err.message}\n`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log('─'.repeat(52));
  console.log(`✅  Done — ${ok} imported, ${skipped} skipped, ${failed} failed`);
  if (ok > 0 && !DRY_RUN) {
    console.log('\n💡  Update any ₹0 prices in the admin panel at /fragrance');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
