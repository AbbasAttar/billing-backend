import { describe, it, expect } from 'vitest';
import {
  vendorCategorySummary,
  repaymentProgress,
  paidByMonth,
  isMonthKey,
  buildRepaymentSchedule,
  chequesByMonth,
  addMonthKey,
} from '../src/services/expenseLedger';

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

describe('repayment schedule builder', () => {
  const total = (rows: { month: string; amount: number }[], month: string) =>
    rows.filter((r) => r.month === month).reduce((t, r) => t + r.amount, 0);

  it('splits each month by what is owed and spends the budget exactly', () => {
    const rows = buildRepaymentSchedule(
      [
        { _id: 'a', balance: 60000 },
        { _id: 'b', balance: 30000 },
        { _id: 'c', balance: 0 },
      ],
      30000,
      '2026-11',
    );
    expect(rows.filter((r) => r.month === '2026-11')).toEqual([
      { month: '2026-11', vendorId: 'b', amount: 10000 },
      { month: '2026-11', vendorId: 'a', amount: 20000 },
    ]);
    expect(total(rows, '2026-12')).toBe(30000);
    expect(total(rows, '2027-01')).toBe(30000);
    expect(rows.some((r) => r.month === '2027-02')).toBe(false);
    expect(rows.some((r) => r.vendorId === 'c')).toBe(false);
  });

  it('pays dues under ₹5,000 in one go and the rest in ₹5,000 steps', () => {
    const rows = buildRepaymentSchedule([{ _id: 'a', balance: 1500 }, { _id: 'b', balance: 100000 }], 20000, '2026-11');
    // 18,500 left after the small one: three whole steps; the odd 3,500 is not scheduled.
    expect(rows.filter((r) => r.month === '2026-11')).toEqual([
      { month: '2026-11', vendorId: 'a', amount: 1500 },
      { month: '2026-11', vendorId: 'b', amount: 15000 },
    ]);
    expect(rows.every((r) => r.amount < 5000 || r.amount % 5000 === 0)).toBe(true);
  });

  it('pays an odd remainder under ₹5,000 the month after the last step', () => {
    const rows = buildRepaymentSchedule([{ _id: 'a', balance: 12300 }], 50000, '2026-11');
    expect(rows).toEqual([
      { month: '2026-11', vendorId: 'a', amount: 10000 },
      { month: '2026-12', vendorId: 'a', amount: 2300 },
    ]);
  });

  it('shares steps by dues, giving spare steps to the biggest share first', () => {
    const rows = buildRepaymentSchedule(
      [
        { _id: 'a', balance: 108264 },
        { _id: 'b', balance: 69730 },
        { _id: 'c', balance: 23885 },
      ],
      50000,
      '2026-11',
    );
    const nov = Object.fromEntries(rows.filter((r) => r.month === '2026-11').map((r) => [r.vendorId, r.amount]));
    expect(nov).toEqual({ a: 25000, b: 20000, c: 5000 });
  });

  it('counts pending cheques against the dues and their month budget', () => {
    const rows = buildRepaymentSchedule([{ _id: 'a', balance: 50000 }], 20000, '2026-11', { '2026-11': { a: 15000 } });
    // 35,000 left after the cheque: 5,000 in Nov (budget minus cheque), then 20,000 and 10,000.
    expect(rows).toEqual([
      { month: '2026-11', vendorId: 'a', amount: 5000 },
      { month: '2026-12', vendorId: 'a', amount: 20000 },
      { month: '2027-01', vendorId: 'a', amount: 10000 },
    ]);
  });

  it('adds month keys across years and groups vendor cheques by month', () => {
    expect(addMonthKey('2026-12', 1)).toBe('2027-01');
    expect(
      chequesByMonth([
        { vendorId: 'a', amount: 5000, chequeDate: new Date(2026, 10, 5) },
        { vendorId: 'a', amount: 2000, chequeDate: new Date(2026, 10, 25) },
        { amount: 9999, chequeDate: new Date(2026, 10, 1) },
      ]),
    ).toEqual({ '2026-11': { a: 7000 } });
  });
});
