import { describe, it, expect } from 'vitest';
import { buildFittingInsights } from '../src/services/fittingInsights';

const from = new Date('2026-10-01T00:00:00');
const now = new Date('2026-10-22T12:00:00');

const job = (o: Record<string, any>) => {
  const j = { party: 'p1', date: '2026-10-10', lensSpec: 'CR HC WHITE', quantity: 1, lensCost: 0, margin: 0, fittingCharge: 0, total: 0, status: 'ordered', billed: false, ...o };
  return { ...j, lensCharge: j.lensCost + j.margin };
};

describe('fitting insights', () => {
  const parties = [
    { _id: 'p1', name: 'Shah Opticals', billThreshold: 1000 },
    { _id: 'p2', name: 'Dr Mehta', shopName: 'Eye Clinic' },
    { _id: 'p3', name: 'Idle Optician' },
  ];
  const jobs = [
    job({ lensCost: 300, margin: 100, fittingCharge: 50, total: 450 }),
    job({ lensCost: 500, margin: 150, fittingCharge: 100, total: 750, date: '2026-10-15' }),
    job({ party: 'p2', lensSpec: 'CR ARC', lensCost: 200, margin: 80, fittingCharge: 60, total: 340, billed: true }),
    job({ party: 'p2' }), // not priced yet
    job({ lensCost: 999, total: 999, status: 'cancelled' }),
  ];
  const statements = [
    { party: 'p2', total: 2000, status: 'paid', paidAt: '2026-10-05' },
    { party: 'p2', total: 900, status: 'paid', paidAt: '2026-09-01' }, // paid before the window
    { party: 'p2', total: 340, status: 'unpaid' },
  ];

  const r = buildFittingInsights({
    jobs,
    previousJobs: [job({ margin: 40, fittingCharge: 60, total: 300, lensCost: 200 })],
    openJobs: jobs.filter((j) => !j.billed),
    parties,
    statements,
    from,
    now,
  });

  it('totals priced, live jobs; profit is margin + fitting', () => {
    expect(r).toMatchObject({ jobs: 4, unpricedJobs: 1, revenue: 1540, lensCost: 1000, margin: 330, fittingIncome: 210, profit: 540 });
    expect(r.profitPct).toBe(35.1);
    expect(r.avgProfitPerJob).toBe(180);
    expect(r.previous).toEqual({ jobs: 1, revenue: 300, profit: 100 });
  });

  it('splits money still out: open account, unpaid statements, collected in window', () => {
    expect(r.openTotal).toBe(1200);
    expect(r.unpaidTotal).toBe(340);
    expect(r.unpaidStatements).toBe(1);
    expect(r.collected).toBe(2000);
  });

  it('ranks opticians and flags who is due a bill', () => {
    expect(r.byParty.map((p) => p.party)).toEqual(['p1', 'p2']);
    expect(r.byParty[0]).toMatchObject({ revenue: 1200, profit: 400, openTotal: 1200, billDue: true });
    expect(r.byParty[1]).toMatchObject({ name: 'Dr Mehta (Eye Clinic)', jobs: 2, unpaidTotal: 340, billDue: false });
    expect(r.billsDue).toBe(1);
  });

  it('counts priced jobs still missing the lens cost', () => {
    expect(r.noCostJobs).toBe(0);
    const noCost = buildFittingInsights({
      jobs: [{ party: 'p1', date: '2026-10-10', lensCharge: 500, margin: 500, fittingCharge: 100, total: 600 }],
      previousJobs: [], openJobs: [], parties, statements: [], from, now,
    });
    expect(noCost).toMatchObject({ noCostJobs: 1, profit: 600 });
  });

  it('groups by lens spec', () => {
    expect(r.byLens[0]).toMatchObject({ spec: 'CR HC WHITE', jobs: 3, profit: 400 });
    expect(r.byLens.find((l) => l.spec === 'CR ARC')).toMatchObject({ jobs: 1, profit: 140 });
  });
});
