/**
 * Import Naseem Classic Collection from products.csv + local images.
 *
 * Usage:
 *   node scripts/importNaseemClassic.mjs [--dry-run]
 *
 * Prerequisites:
 *   - Backend running at http://localhost:3001
 *   - Service account JSON at the path below
 *   - CSV + images at C:\Users\abbas\Downloads\naseem-scraper\
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { GoogleAuth } from 'google-auth-library';

// ─── Config ──────────────────────────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = 'C:/Users/abbas/Downloads/attarwala-46200-adb62f5d6391.json';
const SCRAPER_DIR          = 'C:/Users/abbas/Downloads/naseem-scraper';
const CSV_FILE             = join(SCRAPER_DIR, 'products.csv');
const IMAGES_BASE          = join(SCRAPER_DIR, 'images/classic-collection');
const API_BASE             = 'http://localhost:3001/api';
const BUCKET               = 'attarwala-46200.firebasestorage.app';
const STORAGE_FOLDER       = 'naseem/classic-collection';

const DRY_RUN = process.argv.includes('--dry-run');

// ─── CSV parser (handles quoted fields with commas) ───────────────────────────
function parseCSV(filepath) {
  const lines = readFileSync(filepath, 'utf-8').trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        values.push(cell.trim());
        cell = '';
      } else {
        cell += ch;
      }
    }
    values.push(cell.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

// ─── Firebase Storage upload ──────────────────────────────────────────────────
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
  const data = readFileSync(localPath);
  const encoded = encodeURIComponent(storagePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encoded}`;

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
  const res = await fetch(`${API_BASE}/fragrances?q=${encodeURIComponent(slug)}`);
  if (!res.ok) return false;
  const list = await res.json();
  return list.some(f => f.web?.slug === slug);
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
  console.log(DRY_RUN ? '\n🔍  DRY RUN — nothing will be uploaded or written\n' : '\n🚀  Naseem Classic Collection import starting…\n');

  const all = parseCSV(CSV_FILE);
  const classics = all.filter(p => p.collection === 'Classic Collection' && p.status === 'active');
  console.log(`Found ${classics.length} Classic Collection products in CSV\n`);

  const token = DRY_RUN ? null : await getAccessToken();
  let ok = 0, skipped = 0, failed = 0;

  for (const row of classics) {
    const imageName   = row.image_file.replace('images/classic-collection/', '');
    const localImage  = join(IMAGES_BASE, imageName);
    const storagePath = `${STORAGE_FOLDER}/${imageName}`;
    const slug        = `naseem-${row.slug}`;
    const displayName = `Naseem ${row.product_name} ${row.size_ml}ml`;

    console.log(`▶  ${displayName}`);
    console.log(`   slug: ${slug} | image: ${imageName}`);

    // Verify image exists locally
    if (!existsSync(localImage)) {
      console.warn(`   ⚠  Image not found at ${localImage} — skipping\n`);
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`   [DRY RUN] Would upload image and create fragrance record\n`);
      continue;
    }

    // Skip if slug already in DB
    const exists = await slugExists(slug);
    if (exists) {
      console.log(`   ⏩  Slug already exists — skipping\n`);
      skipped++;
      continue;
    }

    try {
      const imageUrl = await uploadImage(token, localImage, storagePath);
      console.log(`   ✓  Image uploaded`);

      const fragranceFamily = row.fragrance_family ? [row.fragrance_family] : ['Oriental'];

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
            'classic-collection',
            'oriental',
            'perfume',
            `${row.size_ml}ml`,
            row.product_name.toLowerCase(),
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
      console.log(`   ✓  Fragrance record created\n`);
      ok++;
    } catch (err) {
      console.error(`   ✗  ${err.message}\n`);
      failed++;
    }

    // Small pause — avoid hammering the API
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('─'.repeat(50));
  console.log(`✅  Done — ${ok} imported, ${skipped} skipped, ${failed} failed`);
  if (ok > 0) {
    console.log('\n💡  Prices are set to ₹0 — update them in the admin panel at /fragrance');
    console.log('    They are already published and visible on the website.');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
