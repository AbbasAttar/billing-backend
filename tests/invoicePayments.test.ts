import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/firebaseAdmin', () => ({ getAdminAuth: () => null, getAdminFirestore: () => null, getAdminMessaging: () => null }));

import { keepsExistingPayments } from '../src/controllers/invoice.controller';

const d1 = new Date('2026-10-01T05:00:00.000Z');
const d2 = new Date('2026-10-05T09:30:00.000Z');
const existing = [
  { date: d1, amount: 500, method: 'cash' as const, writeoff: 0 },
  { date: d2, amount: 300, method: 'online' as const, writeoff: 50 },
];

describe('keepsExistingPayments (staff may only append)', () => {
  it('allows the same list, or the same list plus new payments', () => {
    expect(keepsExistingPayments(existing, existing.map((p) => ({ ...p })))).toBe(true);
    expect(keepsExistingPayments(existing, [...existing, { date: new Date(), amount: 200, method: 'cash', writeoff: 0 }])).toBe(true);
  });

  it('accepts dates sent back as ISO strings', () => {
    const roundTrip = existing.map((p) => ({ ...p, date: new Date(p.date.toISOString()) }));
    expect(keepsExistingPayments(existing, roundTrip)).toBe(true);
  });

  it('refuses removing, re-dating, changing an amount, method or write-off', () => {
    expect(keepsExistingPayments(existing, [existing[0]])).toBe(false);
    expect(keepsExistingPayments(existing, [existing[0], { ...existing[1], date: d1 }])).toBe(false);
    expect(keepsExistingPayments(existing, [{ ...existing[0], amount: 400 }, existing[1]])).toBe(false);
    expect(keepsExistingPayments(existing, [{ ...existing[0], method: 'online' }, existing[1]])).toBe(false);
    expect(keepsExistingPayments(existing, [existing[0], { ...existing[1], writeoff: 0 }])).toBe(false);
  });

  it('anything goes when nothing was recorded yet', () => {
    expect(keepsExistingPayments([], [{ date: d1, amount: 100, method: 'cash' }])).toBe(true);
  });
});
