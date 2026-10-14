import { describe, it, expect } from 'vitest';
import { buildFragranceInsights } from '../src/services/categoryInsights';

const now = new Date('2026-10-14T10:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe('buildFragranceInsights', () => {
  const out = buildFragranceInsights({
    invoices: [
      { billDate: ago(1), items: [{ fragrance: 'r1', quantity: 2, price: 300, costPrice: 120 }, { wholesaleItem: 'w1', type: 'wholesale', itemName: 'Majmua', quantity: 10, price: 75, costPrice: 70 }] },
    ],
    fragrances: [
      { _id: 'r1', name: 'Rose', type: 'attar', costPrice: 120, stock: 0 },
      { _id: 'r2', name: 'Oud', type: 'perfume', costPrice: 500, stock: 2 },
    ],
    wholesale: [
      { _id: 'w1', name: 'Majmua', stock: 1, reorderLevel: 5 },
      { _id: 'w2', name: 'Musk', stock: 0, isOrdered: true, orderedQty: 10, orderedAt: ago(9) },
    ],
    days: 30, now,
  });

  it('splits retail and wholesale', () => {
    expect(out.retail).toEqual({ revenue: 600, units: 2, marginPct: 60, missingCost: 0 });
    expect(out.wholesale.revenue).toBe(750);
    expect(out.typeMix[0]).toMatchObject({ name: 'attar', units: 2 });
  });

  it('finds sold-out sellers, unsold stock, low wholesale and overdue orders', () => {
    expect(out.soldOut.map((s) => s.name)).toEqual(['Rose']);
    expect(out.unsold).toMatchObject({ count: 1, value: 1000 });
    expect(out.wholesaleStock.low.map((w) => w.name)).toEqual(['Majmua']);
    expect(out.wholesaleStock.overdue[0]).toMatchObject({ name: 'Musk', days: 9 });
    const titles = out.guidance.map((g) => g.title).join(' | ');
    expect(titles).toMatch(/now out of stock/);
    expect(titles).toMatch(/low and not ordered/);
    expect(titles).toMatch(/waiting more than 7 days/);
    expect(titles).toMatch(/under 25% margin/); // wholesale Majmua at ~6.7%
  });
});

describe('archived products', () => {
  it('name old sales but stay out of stock lists', () => {
    const out = buildFragranceInsights({
      invoices: [{ billDate: ago(1), items: [{ fragrance: 'old', quantity: 0.5, price: 400 }] }],
      fragrances: [{ _id: 'old', name: 'Retired Musk', isArchived: true, stock: 0 }, { _id: 'gone', name: 'Archived Stock', isArchived: true, stock: 4 }],
      wholesale: [], days: 30, now,
    });
    expect(out.topRetail[0]).toMatchObject({ name: 'Retired Musk', units: 0.5 });
    expect(out.soldOut).toEqual([]);
    expect(out.unsold.count).toBe(0);
  });
});

describe('fragrance margin from the saved cost', () => {
  it('ignores the cost copied onto the bill and lists fragrances with no saved cost', () => {
    const out = buildFragranceInsights({
      invoices: [{ billDate: ago(1), items: [
        { fragrance: 'a', quantity: 2, price: 300, costPrice: 290 }, // bill copy says 290, saved cost is 100
        { fragrance: 'b', fragranceGrade: '6ml', quantity: 1, price: 450, costPrice: 400 }, // variant cost 200
        { fragrance: 'c', quantity: 1, price: 500, costPrice: 100 }, // no saved cost at all
      ] }],
      fragrances: [
        { _id: 'a', name: 'Rose', costPrice: 100, stock: 3 },
        { _id: 'b', name: 'Oud', variants: [{ label: '6ml', costPrice: 200, stock: 2 }] },
        { _id: 'c', name: 'Musk', stock: 1 },
      ],
      wholesale: [], days: 30, now,
    });
    // costed: Rose 600 − 200, Oud 450 − 200 → 650 / 1050
    expect(out.retail.marginPct).toBe(Number(((650 / 1050) * 100).toFixed(1)));
    expect(out.retail.missingCost).toBe(1);
    expect(out.soldWithoutCost).toEqual([{ id: 'c', name: 'Musk', brand: undefined, type: undefined, sold: 1, revenue: 500 }]);
  });
});

describe('catch-all products', () => {
  it('fragrance "Wholesale" and "Attar": revenue only, out of margin and lists', () => {
    const out = buildFragranceInsights({
      invoices: [{ billDate: ago(1), items: [
        { fragrance: 'w', quantity: 3, price: 150 }, { fragrance: 'a', quantity: 1, price: 200 }, { fragrance: 'r', quantity: 1, price: 250 },
      ] }],
      fragrances: [
        { _id: 'w', name: 'Wholesale', costPrice: 1752.5, stock: 0 },
        { _id: 'a', name: ' attar ', stock: 4 },
        { _id: 'r', name: 'Rose', costPrice: 100, stock: 2 },
      ],
      wholesale: [], days: 30, now,
    });
    expect(out.retail).toEqual({ revenue: 900, units: 5, marginPct: 60, missingCost: 0 });
    expect(out.mixedSales.revenue).toBe(650);
    expect(out.topRetail.map((r) => r.name)).toEqual(['Rose']);
    expect(out.soldOut).toEqual([]);
    expect(out.soldWithoutCost).toEqual([]);
    expect(out.unsold.count).toBe(0);
  });

});
