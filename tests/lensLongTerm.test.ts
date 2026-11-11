import { describe, expect, it } from 'vitest';
import { buildLongTerm } from '../src/services/lensLongTerm';

const bill = (o: object) => ({ lensType: 'Single Vision', quantity: 1, price: 500, createdAt: new Date('2026-10-05'), ...o });
const book = (o: object) => ({ date: new Date('2022-03-01'), lensType: 'Bifocal', qty: 1, sellPrice: 600, buyPrice: null, ...o });

describe('buildLongTerm', () => {
  it('splits pairs and sales by year between bills and the book', () => {
    const r = buildLongTerm([bill({}), bill({ eye: 'left' })], [book({}), book({ date: new Date('2022-08-01'), qty: 2 })]);
    expect(r.years).toEqual([
      { year: 2022, billPairs: 0, billRevenue: 0, bookPairs: 3, bookRevenue: 1800 },
      { year: 2026, billPairs: 1.5, billRevenue: 1000, bookPairs: 0, bookRevenue: 0 },
    ]);
    expect(r.total).toMatchObject({ pairs: 4.5, revenue: 2800, bookEntries: 2, bookPairs: 3 });
  });

  it('works out margin only from lines with a cost, from both sources', () => {
    const r = buildLongTerm(
      [bill({ costPrice: 200 }), bill({})],
      [book({ buyPrice: 300 }), book({ lensType: 'Single Vision', sellPrice: 400, buyPrice: 100 })],
    );
    const sv = r.types.find((t) => t.type === 'Single Vision')!;
    // costed: bill 500 (cost 200) + book 400 (cost 100) → (900 - 300) / 900
    expect(sv.marginPct).toBe(67);
    expect(sv.costedPct).toBe(64); // 900 of 1400
    expect(r.types.find((t) => t.type === 'Bifocal')).toMatchObject({ marginPct: 50, bookPairs: 1, avgPerPair: 600 });
  });

  it('counts Kryptok bills and odd names the same way as the rest of analytics', () => {
    const r = buildLongTerm([bill({ lensType: 'Kryptok Bifocal' }), bill({ lensType: 'CR Drivesafe', lensCategory: null })], []);
    expect(r.types.map((t) => t.type).sort()).toEqual(['Bifocal', 'Other']);
  });

  it('skips non-lens bill lines', () => {
    const r = buildLongTerm([{ type: 'frame', quantity: 1, price: 900, createdAt: new Date() } as any], []);
    expect(r.total.pairs).toBe(0);
  });
});
