import { describe, it, expect } from 'vitest';
import {
  applyRecurringPayment,
  reverseRecurringPayment,
  resetRecurring,
  vendorBalanceDelta,
  RecurringState,
} from '../src/services/expenseLedger';

const rent: RecurringState = { kind: 'ongoing', amount: 25000, paidInstallments: 0, dueRemaining: 25000, cycle: 1, status: 'active' };
const loan: RecurringState = { kind: 'installment', amount: 5000, totalInstallments: 2, paidInstallments: 1, dueRemaining: 5000, cycle: 2, status: 'active' };

const unwrap = <T>(r: { ok: true; state: T } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('recurring bills', () => {
  it('partial payments reduce what is due, the last one completes the installment', () => {
    const a = applyRecurringPayment(rent, 10000);
    expect(a.ok && a.state.dueRemaining).toBe(15000);
    expect(a.ok && a.completedInstallment).toBeFalsy();

    const b = applyRecurringPayment(unwrap(a), 15000);
    expect(b.ok && b.completedInstallment).toBe(true);
    expect(unwrap(b)).toMatchObject({ dueRemaining: 0, paidInstallments: 1, status: 'active' });
  });

  it('refuses paying more than is due, or when nothing is due', () => {
    expect(applyRecurringPayment(rent, 30000).ok).toBe(false);
    expect(applyRecurringPayment({ ...rent, dueRemaining: 0 }, 100).ok).toBe(false);
  });

  it('installment bills complete after the last installment; ongoing never do', () => {
    expect(unwrap(applyRecurringPayment(loan, 5000)).status).toBe('completed');
    expect(unwrap(applyRecurringPayment({ ...rent, paidInstallments: 99 }, 25000)).status).toBe('active');
  });

  it('reset starts the next cycle, optionally with a new amount', () => {
    const paid = unwrap(applyRecurringPayment(rent, 25000));
    expect(unwrap(resetRecurring(paid))).toMatchObject({ dueRemaining: 25000, cycle: 2 });
    expect(unwrap(resetRecurring(paid, 27000))).toMatchObject({ amount: 27000, dueRemaining: 27000 });
    expect(resetRecurring({ ...loan, status: 'completed' }).ok).toBe(false);
  });

  it('undoing a payment restores the due amount and installment count', () => {
    const done = unwrap(applyRecurringPayment(loan, 5000));
    const back = unwrap(reverseRecurringPayment(done, { amount: 5000, cycle: 2, completedInstallment: true }));
    expect(back).toMatchObject({ dueRemaining: 5000, paidInstallments: 1, status: 'active' });

    const partial = unwrap(applyRecurringPayment(rent, 4000));
    expect(unwrap(reverseRecurringPayment(partial, { amount: 4000, cycle: 1 })).dueRemaining).toBe(25000);
  });

  it('a payment from an earlier cycle cannot be undone', () => {
    expect(reverseRecurringPayment({ ...rent, cycle: 3 }, { amount: 100, cycle: 2 }).ok).toBe(false);
  });
});

describe('one-time dues', () => {
  const doctor: RecurringState = { kind: 'one_time', amount: 5000, paidInstallments: 0, dueRemaining: 5000, cycle: 1, status: 'active' };

  it('can be paid in parts and completes once fully paid; never resets', () => {
    const a = unwrap(applyRecurringPayment(doctor, 2000));
    expect(a).toMatchObject({ dueRemaining: 3000, status: 'active' });
    expect(unwrap(applyRecurringPayment(a, 3000)).status).toBe('completed');
    expect(resetRecurring(doctor).ok).toBe(false);
  });
});

describe('split recurring bills', () => {
  const split: RecurringState = {
    ...rent,
    parts: [
      { label: 'Rent cash', method: 'cash', amount: 12500, due: 12500 },
      { label: 'Rent online', method: 'upi', amount: 12500, due: 12500 },
    ],
  };

  it('each part is paid on its own; the cycle clears when both are paid', () => {
    expect(applyRecurringPayment(split, 100).ok).toBe(false); // part required
    const a = unwrap(applyRecurringPayment(split, 12500, 0));
    expect(a).toMatchObject({ dueRemaining: 12500, paidInstallments: 0 });
    expect(applyRecurringPayment(a, 100, 0).ok).toBe(false); // cash part already paid
    expect(applyRecurringPayment(a, 13000, 1).ok).toBe(false); // more than the online part
    const b = applyRecurringPayment(a, 12500, 1);
    expect(b.ok && b.completedInstallment).toBe(true);
    expect(unwrap(b)).toMatchObject({ dueRemaining: 0, paidInstallments: 1 });
  });

  it('undo puts the amount back on the same part', () => {
    const a = unwrap(applyRecurringPayment(split, 5000, 1));
    const back = unwrap(reverseRecurringPayment(a, { amount: 5000, cycle: 1, part: 1 }));
    expect(back.parts![1].due).toBe(12500);
    expect(back.dueRemaining).toBe(25000);
  });

  it('reset restores every part, optionally with new amounts', () => {
    const paid = unwrap(applyRecurringPayment(unwrap(applyRecurringPayment(split, 12500, 0)), 12500, 1));
    expect(unwrap(resetRecurring(paid))).toMatchObject({ amount: 25000, dueRemaining: 25000, cycle: 2 });
    const raised = unwrap(resetRecurring(paid, undefined, [13000, 12500]));
    expect(raised).toMatchObject({ amount: 25500, dueRemaining: 25500 });
    expect(raised.parts![0]).toMatchObject({ amount: 13000, due: 13000 });
    expect(resetRecurring(paid, undefined, [100]).ok).toBe(false);
  });
});

describe('vendor balance', () => {
  it('add raises what is owed, pay and less lower it', () => {
    expect(vendorBalanceDelta('add', 500)).toBe(500);
    expect(vendorBalanceDelta('pay', 200)).toBe(-200);
    expect(vendorBalanceDelta('less', 50)).toBe(-50);
  });
});
