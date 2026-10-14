import { describe, it, expect } from 'vitest';
import { collections, dailySeries, expenseFigures, resolvePeriod, salesFigures, targetProgress } from '../src/services/analyticsOverview';

const now = new Date(2026, 9, 14, 15, 0); // 14 Oct 2026

describe('resolvePeriod', () => {
  it('month to date compares with the same days of last month', () => {
    const p = resolvePeriod('mtd', now);
    expect(p.from).toEqual(new Date(2026, 9, 1));
    expect(p.compareFrom).toEqual(new Date(2026, 8, 1));
    expect(p.compareTo.getDate()).toBe(14);
    expect(p.compareLabel).toBe('Sep 1–14');
    expect(p).toMatchObject({ targetMonth: '2026-10', daysInMonth: 31, daysElapsed: 14 });
  });
  it('last month compares with the month before', () => {
    const p = resolvePeriod('last_month', now);
    expect(p.label).toBe('Sep 2026');
    expect(p.compareLabel).toBe('Aug 2026');
    expect(p.to.getDate()).toBe(30);
  });
});

describe('salesFigures', () => {
  const bills = [
    // ₹1,000 billed, ₹100 off: the frame line has a cost, the lens line does not.
    { billDate: now, subtotal: 1000, discount: 100, total: 900, isNewCustomer: true, acquisitionSource: 'instagram', packagingCost: 20, paymentProcessingFee: 5,
      items: [{ frame: 'f', quantity: 1, price: 600, costPrice: 300 }, { lensType: 'SV', quantity: 1, price: 400 }] },
    { billDate: now, subtotal: 500, discount: 0, total: 500, isNewCustomer: false, items: [{ fragrance: 'r', quantity: 2, price: 250, costPrice: 100 }] },
    { billDate: now, subtotal: 200, discount: 0, total: 200, isNewCustomer: true, items: [{ wholesaleItem: 'w', type: 'wholesale', quantity: 4, price: 50, costPrice: 40 }] },
  ];
  const s = salesFigures(bills);

  it('reconciles categories with revenue through the discount line', () => {
    expect(s.billed - s.discount).toBe(s.revenue);
    expect(s.categories.reduce((t, c) => t + c.revenue, 0)).toBe(s.billed);
  });

  it('gross profit only counts costed lines, after their discount share', () => {
    // frame: 600 × 0.9 = 540 − 300 = 240; fragrance 500 − 200 = 300; wholesale 200 − 160 = 40
    expect(s.grossProfit).toBe(580);
    expect(s.marginPct).toBe(Number(((580 / 1240) * 100).toFixed(1)));
    expect(s.uncostedLines).toBe(1);
    expect(s.coveragePct).toBe(Number(((1240 / 1600) * 100).toFixed(1)));
  });

  it('net contribution is never above gross profit', () => {
    expect(s.netContribution).toBe(580 - 20 - 5);
    expect(s.netContribution!).toBeLessThanOrEqual(s.grossProfit!);
  });

  it('acquisition: repeat customers are "repeat", missing source is "not recorded"', () => {
    const src = Object.fromEntries(s.customers.sources.map((x) => [x.source, x.revenue]));
    expect(src).toEqual({ instagram: 900, repeat: 500, not_recorded: 200 });
  });

  it('no cost prices at all gives no profit figure instead of 100%', () => {
    expect(salesFigures([{ billDate: now, total: 100, items: [{ frame: 'x', quantity: 1, price: 100 }] }]).grossProfit).toBeNull();
  });
});

describe('collections and expenses', () => {
  const from = new Date(2026, 9, 1);
  const to = new Date(2026, 9, 14, 23, 59);
  it('counts payments by payment date and splits cash / UPI', () => {
    const c = collections([
      { billDate: new Date(2026, 8, 20), payments: [{ date: new Date(2026, 8, 20), amount: 100, method: 'cash' }, { date: new Date(2026, 9, 2), amount: 300, method: 'online' }] },
      { billDate: new Date(2026, 9, 3), payments: [{ date: new Date(2026, 9, 3), amount: 200, method: 'cash' }] },
    ], from, to);
    expect(c).toMatchObject({ total: 500, cash: 200, upi: 300 });
  });
  it('splits stock purchases and home spending from running expenses', () => {
    const e = expenseFigures([
      { date: new Date(2026, 9, 5), amount: 20000, category: 'stock', paymentMethod: 'bank_transfer' },
      { date: new Date(2026, 9, 5), amount: 5000, category: 'vendor_order', paymentMethod: 'cash' },
      { date: new Date(2026, 9, 6), amount: 8000, category: 'rent', paymentMethod: 'upi' },
      { date: new Date(2026, 9, 6), amount: 200, category: 'staff_tea', paymentMethod: 'cash' },
      { date: new Date(2026, 9, 7), amount: 3000, category: 'home_expense', paymentMethod: 'cash' },
    ], from, to);
    expect(e).toMatchObject({ stockPurchases: 25000, operating: 8200, home: 3000, cashOut: 5200 });
    expect(e.operatingByCategory[0]).toEqual({ category: 'rent', amount: 8000 });
  });
});

describe('targetProgress', () => {
  it('shows achieved and projected separately, and the real daily need', () => {
    const t = targetProgress(131089, 81720, resolvePeriod('mtd', now))!;
    expect(t.achievedPct).toBe(62.3);
    expect(t.projected).toBe(Math.round((81720 / 14) * 31));
    expect(t.remainingDays).toBe(17);
    expect(t.requiredPerDay).toBe(Math.round((131089 - 81720) / 17));
  });
  it('no target set gives no target card', () => {
    expect(targetProgress(0, 1000, resolvePeriod('mtd', now))).toBeNull();
    expect(targetProgress(5000, 1000, resolvePeriod('30d', now))).toBeNull();
  });
});

describe('dailySeries', () => {
  it('lines up each day with the same day of the comparison period', () => {
    const p = resolvePeriod('mtd', now);
    const d = dailySeries([{ billDate: new Date(2026, 9, 2, 11), total: 500 }], [{ billDate: new Date(2026, 8, 2, 18), total: 300 }], p);
    expect(d).toHaveLength(14);
    expect(d[1]).toMatchObject({ date: '2026-10-02', revenue: 500, previous: 300 });
  });
});
