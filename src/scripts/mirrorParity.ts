/**
 * Parity check for collection mirrors: calls read-only GET endpoints with mirrors disabled (legacy
 * full scans) and enabled, diffs the JSON and prints Firestore reads per call.
 *
 *   npx ts-node --transpile-only src/scripts/mirrorParity.ts
 */
process.env.FS_READ_WARN_THRESHOLD = '1';
process.env.MIRROR_FRESH_MS = '0';

import type { AddressInfo } from 'node:net';

const ENDPOINTS = [
  '/dashboard/daily',
  '/dashboard/daily?date=2026-10-01',
  '/dashboard/finance-overview',
  '/dashboard/cashflow',
  '/dashboard/command-center',
  '/dashboard/profit-leakage',
  '/dashboard/recent-payments',
  '/dashboard/daily-tasks',
  '/analytics/executive',
  '/analytics/unit-economics',
  '/analytics/sales-distribution',
  '/analytics/summary',
  '/analytics/monthly-summary',
  '/analytics/top-items',
  '/analytics/category-sales',
  '/analytics/fragrance-type-mix',
  '/analytics/lens-type-demand',
  '/expenses/hub-summary',
  '/expenses/summary',
  '/finance/dashboard',
  '/finance/planner-command-center',
  '/finance/attention',
  '/sales/intelligence',
  '/inventory/intelligence',
  '/payments/pending',
  '/payments/given',
  '/cashflow/summary',
  '/optical-lenses/analytics',
  '/lens-stock/trends',
  '/frames/trends',
  '/fragrances/revenue-summary',
  '/fragrances/trends',
  '/frames',
  '/fragrances',
  '/customers',
  '/marketing/summary',
  '/public/my-invoices?phone=9999999999',
  '/public/products',
  '/public/products?category=frames&sort=price_asc',
  '/public/products?category=sunglasses',
  '/public/products?category=attars&page=2',
  '/public/products?category=perfumes&sort=popular',
  '/public/products?category=contact-lenses',
  '/public/products?tag=best-seller',
  '/public/products?category=frames&priceMin=500&priceMax=3000',
  '/public/categories',
  '/public/homepage',
  '/public/search?q=oud',
  '/public/search?q=round',
  '/public/lens-catalog',
  '/public/lens-pricing-lookup',
  '/public/coatings',
  '/public/colors',
];

const VOLATILE = new Set(['generatedAt', 'timestamp', 'computedAt', 'asOf']);

function canon(value: any): any {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      if (!VOLATILE.has(key)) out[key] = canon(value[key]);
    }
    return out;
  }
  return value;
}

function firstDiff(a: any, b: any, path = ''): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 120)} != ${JSON.stringify(b)?.slice(0, 120)}`;
}

async function run() {
  const reads: number[] = [];
  let lastDetail = '';
  const origWarn = console.warn;
  console.warn = (...args: any[]) => {
    const line = String(args[0] ?? '');
    const m = line.match(/^\[FS-READS\].* total=(\d+)(.*)/);
    if (m) {
      reads.push(Number(m[1]));
      if (Number(m[1]) > 150) lastDetail = m[2].trim();
    }
    else if (!line.startsWith('[FS-EXPENSIVE]')) origWarn(...args);
  };

  const { default: app } = await import('../app');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const call = async (url: string) => {
    reads.length = 0;
    const res = await fetch(base + url);
    const body = await res.text();
    await new Promise((r) => setTimeout(r, 20));
    let json: any = body;
    try { json = JSON.parse(body); } catch { /* keep text */ }
    return { status: res.status, json: canon(json), reads: reads[0] ?? 0 };
  };

  let mismatches = 0;
  const only = process.argv[2];
  for (const url of ENDPOINTS.filter((u) => !only || u.startsWith(only))) {
    process.env.DISABLE_COLLECTION_MIRRORS = 'true';
    const legacy = await call(url);
    process.env.DISABLE_COLLECTION_MIRRORS = 'false';
    const cold = await call(url);
    lastDetail = '';
    const warm = await call(url);
    const warmDetail = lastDetail;
    const diff = firstDiff(legacy.json, cold.json) ?? firstDiff(legacy.json, warm.json);
    if (diff || legacy.status !== cold.status) mismatches++;
    console.log(
      `${diff ? 'DIFF' : 'same'} ${String(legacy.status)} ${url.padEnd(38)} legacy=${String(legacy.reads).padStart(5)} mirror=${String(cold.reads).padStart(4)} warm=${String(warm.reads).padStart(4)}${warmDetail ? ` [${warmDetail}]` : ''}${diff ? `\n     ${diff}` : ''}`,
    );
  }

  console.log(`\n${mismatches} endpoint(s) differ`);
  server.close();
}

run().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
