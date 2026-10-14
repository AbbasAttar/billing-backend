import { describe, it, expect } from 'vitest';
import { buildFragranceInsights, buildOpticsInsights } from '../src/services/categoryInsights';

const now = new Date('2026-10-14T10:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe('buildOpticsInsights', () => {
  const frames = [
    { _id: 'f1', name: 'Aviator', companyName: 'Ray-Ban', costPrice: 1000, stock: 2, createdAt: ago(30) },
    { _id: 'f2', name: 'Old Rimless', companyName: 'Vogue', costPrice: 800, stock: 3, createdAt: ago(400) },
    { _id: 'f3', name: 'No Cost', companyName: 'Vogue', stock: 1, createdAt: ago(10) },
  ];
  const invoices = [
    { billDate: ago(2), items: [{ frame: 'f1', quantity: 1, price: 2500, costPrice: 1000 }, { lensType: 'Single Vision', lensCoating: 'Blue Cut', quantity: 1, price: 1500 }] },
    { billDate: ago(3), items: [{ frame: { _id: 'f1' }, quantity: 1, price: 2500, costPrice: 1000 }] },
  ];
  const out = buildOpticsInsights({
    invoices, frames,
    lensStock: [{ lensType: 'SV', coating: 'ARC', sph: -1, cyl: 0, quantity: 0, reorderLevel: 2 }, { lensType: 'SV', quantity: 1, reorderLevel: 2 }],
    days: 30, now,
  });

  it('sums sales and leaves margin out for lines without cost', () => {
    expect(out.frames).toEqual({ revenue: 5000, units: 2, marginPct: 60, missingCost: 0 });
    expect(out.lenses).toEqual({ revenue: 1500, units: 1, marginPct: null, missingCost: 1 });
    expect(out.lensAttachPct).toBe(50);
    expect(out.topFrames[0]).toMatchObject({ name: 'Aviator', brand: 'Ray-Ban', units: 2, revenue: 5000, marginPct: 60 });
  });

  it('ages frame stock and counts frames without cost instead of guessing', () => {
    expect(out.frameStock.value).toBe(2 * 1000 + 3 * 800);
    expect(out.frameStock.noCostFrames).toBe(1);
    expect(out.frameStock.aged).toEqual([{ id: 'f2', name: 'Old Rimless', brand: 'Vogue', ageDays: 400, stock: 3, value: 2400 }]);
    expect(out.frameStock.unsoldInPeriod).toEqual({ units: 4, value: 2400 });
  });

  it('lists out-of-stock lens powers, and gives guidance', () => {
    expect(out.lowPowers).toHaveLength(1);
    expect(out.outOfStockPowers).toBe(1);
    const titles = out.guidance.map((g) => g.title).join(' | ');
    expect(titles).toMatch(/1 stock lens power out of stock/);
    expect(titles).toMatch(/1 frame model in stock for over 6 months/);
    expect(titles).toMatch(/without a cost price/);
  });
});

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
