import { describe, it, expect } from 'vitest';
import { vendorCategorySummary, repaymentProgress, paidByMonth, isMonthKey } from '../src/services/expenseLedger';

describe('schedule helpers', () => {
  it('groups payments by month and vendor, ignoring bills', () => {
    const r = paidByMonth([
      { vendorId: 'a', type: 'pay', amount: 5000, date: new Date(2026, 9, 5) },
      { vendorId: 'a', type: 'pay', amount: 2500, date: new Date(2026, 9, 20) },
      { vendorId: 'b', type: 'pay', amount: 1000, date: new Date(2026, 10, 1) },
      { vendorId: 'a', type: 'add', amount: 9999, date: new Date(2026, 9, 6) },
    ]);
    expect(r).toEqual({ '2026-10': { a: 7500 }, '2026-11': { b: 1000 } });
  });

  it('accepts only YYYY-MM month keys', () => {
    expect(isMonthKey('2026-11')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('Nov 2026')).toBe(false);
  });
});

describe('vendor category summary', () => {
  it('sums owed, bought and paid per category against the cap', () => {
    const v = [
      { _id: 'a', category: 'fragrance', balance: 0 },
      { _id: 'b', category: 'lens', balance: 5000 },
    ];
    const txns = [
      { vendorId: 'a', type: 'add' as const, amount: 12000 },
      { vendorId: 'a', type: 'pay' as const, amount: 12000 },
      { vendorId: 'b', type: 'add' as const, amount: 3000 },
      { vendorId: 'b', type: 'add' as const, amount: 50000, note: 'Opening balance' },
    ];
    const rows = vendorCategorySummary(v, txns, { fragrance: 10000, lens: 0 }, ['fragrance', 'lens', 'frame']);
    expect(rows[0]).toMatchObject({ category: 'fragrance', purchased: 12000, paid: 12000, owed: 0, cap: 10000 });
    expect(rows[1]).toMatchObject({ category: 'lens', purchased: 3000, owed: 5000, cap: 0 });
    expect(rows[2]).toMatchObject({ category: 'frame', vendors: 0, purchased: 0 });
  });
});

describe('this month repayment', () => {
  const caps = { fragrance: 10000, lens: 5000, frame: 5000, other: 0 };

  it('unused cap money is added to the repayment target', () => {
    const r = repaymentProgress([{ vendorId: 'a', type: 'pay', amount: 30000 }], 40000, caps);
    expect(r).toMatchObject({ capTotal: 20000, unusedCap: 20000, target: 60000, reduced: 30000, left: 30000 });
  });

  it('buying within the cap uses it up; credit buys lower the progress', () => {
    const r = repaymentProgress(
      [
        { vendorId: 'a', type: 'add', amount: 12000 }, // cash buy: bill…
        { vendorId: 'a', type: 'pay', amount: 12000 }, // …and its payment
        { vendorId: 'b', type: 'add', amount: 8000 }, // on credit
        { vendorId: 'c', type: 'pay', amount: 40000 },
        { vendorId: 'c', type: 'add', amount: 99999, note: 'Opening balance' },
      ],
      40000,
      caps,
    );
    expect(r).toMatchObject({ added: 20000, unusedCap: 0, target: 40000, reduced: 32000, left: 8000 });
  });
});
