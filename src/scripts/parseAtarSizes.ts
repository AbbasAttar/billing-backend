/**
 * One-time migration: parses size-price pairs from each attar's shortDescription
 * and writes them to web.atarSizes so the customer website can display them.
 *
 * Run with:
 *   npx ts-node --transpile-only src/scripts/parseAtarSizes.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Fragrance } from '../models/Fragrance.model';

function parseSizes(text?: string): { label: string; price: number }[] {
  if (!text) return [];

  const sizeRx = /(\d+)\s*ml/gi;
  const sizes: { label: string; end: number }[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = sizeRx.exec(text)) !== null) {
    sizes.push({ label: sm[0].replace(/\s+/g, ''), end: sm.index + sm[0].length });
  }
  if (sizes.length === 0) return [];

  const priceRx = /(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/gi;
  const hits: { value: number; index: number }[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = priceRx.exec(text)) !== null) {
    hits.push({ value: parseFloat(pm[1]), index: pm.index });
  }

  // Fallback: plain number after separator if no currency symbols found
  if (hits.length === 0) {
    const fallRx = /\s*[-:=|(]\s*(\d+(?:\.\d+)?)/g;
    let fm: RegExpExecArray | null;
    while ((fm = fallRx.exec(text)) !== null) {
      hits.push({ value: parseFloat(fm[1]), index: fm.index });
    }
  }

  const seen = new Map<string, number>();
  for (const size of sizes) {
    const next = hits
      .filter((h) => h.index >= size.end)
      .sort((a, b) => a.index - b.index)[0];
    if (next && next.value > 0) seen.set(size.label, next.value);
  }

  return [...seen.entries()].map(([label, price]) => ({ label, price }));
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB\n');

  const attars = await Fragrance.find({ type: 'attar' }).lean();
  console.log(`Found ${attars.length} attars\n`);

  let updated = 0;
  let skipped = 0;
  let noDesc = 0;

  for (const attar of attars) {
    const desc = (attar.web as any)?.shortDescription;
    if (!desc) { noDesc++; continue; }

    const sizes = parseSizes(desc);
    if (sizes.length === 0) { skipped++; continue; }

    await Fragrance.updateOne(
      { _id: attar._id },
      { $set: { 'web.atarSizes': sizes } }
    );

    const sizeStr = sizes.map((s) => `${s.label}=₹${s.price}`).join(', ');
    console.log(`✓ ${attar.name}  →  ${sizeStr}`);
    updated++;
  }

  console.log(`\n─────────────────────────────`);
  console.log(`Updated : ${updated}`);
  console.log(`Skipped (no prices in desc): ${skipped}`);
  console.log(`Skipped (no description)   : ${noDesc}`);
  console.log(`─────────────────────────────`);

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
