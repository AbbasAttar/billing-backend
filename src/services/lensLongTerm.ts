/**
 * All-years lens picture: bills (InvoiceItem lens lines) plus the old paper books (Lens Book).
 * Pairs and revenue per year, and per lens type with margin from every line that has a cost
 * (bill costPrice, book buy price). Prices in the book are per pair; bill lines are price × quantity.
 */
import { lensTypeOf } from './opticsInsights';
import { isLensLine, lineRevenue, linePairs, lineQty, normalizeLensLine, type LensLine } from './lensSales';
import type { ILensBookEntry } from '../models/LensBookEntry.model';

type BookRow = Pick<ILensBookEntry, 'date' | 'lensType' | 'qty' | 'sellPrice' | 'buyPrice'>;

interface Tally { pairs: number; revenue: number; costedRevenue: number; cost: number }
const empty = (): Tally => ({ pairs: 0, revenue: 0, costedRevenue: 0, cost: 0 });

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const margin = (t: Tally) => (t.costedRevenue > 0 ? Math.round(((t.costedRevenue - t.cost) / t.costedRevenue) * 100) : null);
const yearOf = (d: Date | string | undefined) => (d ? new Date(d).getFullYear() : NaN);

export interface LongTermLens {
  years: { year: number; billPairs: number; billRevenue: number; bookPairs: number; bookRevenue: number }[];
  types: { type: string; pairs: number; revenue: number; avgPerPair: number | null; marginPct: number | null; costedPct: number; bookPairs: number }[];
  total: { pairs: number; revenue: number; marginPct: number | null; costedPct: number; bookEntries: number; bookPairs: number };
}

export function buildLongTerm(billLines: LensLine[], book: BookRow[]): LongTermLens {
  const years = new Map<number, { billPairs: number; billRevenue: number; bookPairs: number; bookRevenue: number }>();
  const types = new Map<string, Tally & { bookPairs: number }>();
  const all = empty();
  let bookPairs = 0;
  const yearRow = (y: number) => {
    let r = years.get(y);
    if (!r) years.set(y, (r = { billPairs: 0, billRevenue: 0, bookPairs: 0, bookRevenue: 0 }));
    return r;
  };
  const typeRow = (t: string) => {
    let r = types.get(t);
    if (!r) types.set(t, (r = { ...empty(), bookPairs: 0 }));
    return r;
  };
  const add = (t: Tally, pairs: number, revenue: number, cost: number | null) => {
    t.pairs += pairs;
    t.revenue += revenue;
    if (cost !== null) { t.cost += cost; t.costedRevenue += revenue; }
  };

  for (const raw of billLines) {
    if (!isLensLine(raw)) continue;
    const it = normalizeLensLine(raw);
    const pairs = linePairs(it);
    const revenue = lineRevenue(it);
    const cost = typeof it.costPrice === 'number' && it.costPrice > 0 ? lineQty(it) * it.costPrice : null;
    const y = yearOf(it.createdAt);
    if (Number.isFinite(y)) { const yr = yearRow(y); yr.billPairs += pairs; yr.billRevenue += revenue; }
    add(typeRow(lensTypeOf(it as any)), pairs, revenue, cost);
    add(all, pairs, revenue, cost);
  }

  for (const b of book) {
    const pairs = b.qty > 0 ? b.qty : 1;
    const revenue = b.sellPrice * pairs;
    const cost = typeof b.buyPrice === 'number' ? b.buyPrice * pairs : null;
    const y = yearOf(b.date);
    if (Number.isFinite(y)) { const yr = yearRow(y); yr.bookPairs += pairs; yr.bookRevenue += revenue; }
    const t = typeRow(lensTypeOf({ lensType: b.lensType }));
    add(t, pairs, revenue, cost);
    t.bookPairs += pairs;
    add(all, pairs, revenue, cost);
    bookPairs += pairs;
  }

  const costedPct = (t: Tally) => (t.revenue > 0 ? Math.round((t.costedRevenue / t.revenue) * 100) : 0);
  return {
    years: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, r]) => ({
      year, billPairs: r1(r.billPairs), billRevenue: r0(r.billRevenue), bookPairs: r1(r.bookPairs), bookRevenue: r0(r.bookRevenue),
    })),
    types: [...types.entries()].sort((a, b) => b[1].pairs - a[1].pairs).map(([type, t]) => ({
      type, pairs: r1(t.pairs), revenue: r0(t.revenue), avgPerPair: t.pairs > 0 ? r0(t.revenue / t.pairs) : null,
      marginPct: margin(t), costedPct: costedPct(t), bookPairs: r1(t.bookPairs),
    })),
    total: { pairs: r1(all.pairs), revenue: r0(all.revenue), marginPct: margin(all), costedPct: costedPct(all), bookEntries: book.length, bookPairs: r1(bookPairs) },
  };
}
