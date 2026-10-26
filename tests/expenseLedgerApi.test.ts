import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// ── Mocks: no Firebase; the three ledger models run on an in-memory store ─────
const verifyIdToken = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/firebaseAdmin', () => ({
  getAdminAuth: () => ({ verifyIdToken }),
  getAdminFirestore: () => null,
  getAdminMessaging: () => null,
}));
vi.mock('../src/config/database', () => ({ connectDB: vi.fn(async () => ({})) }));

const fake = vi.hoisted(() => {
  const get = (o: any, path: string) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
  const matches = (doc: any, filter: any) =>
    Object.entries(filter ?? {}).every(([k, v]: [string, any]) => {
      const val = get(doc, k);
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const cmp = (x: any) => (typeof x === 'string' ? x : new Date(x).getTime());
        if ('$gte' in v && !(cmp(val) >= cmp(v.$gte))) return false;
        if ('$lte' in v && !(cmp(val) <= cmp(v.$lte))) return false;
        return true;
      }
      return val === v;
    });
  const query = (rows: any[]) => {
    const q: any = { then: (res: any, rej: any) => Promise.resolve(rows.map((r) => ({ ...r }))).then(res, rej) };
    q.sort = () => q;
    return q;
  };
  let seq = 0;
  let lastTs = 0;
  const model = () => {
    const rows = new Map<string, any>();
    return {
      rows,
      find: (f: any) => query([...rows.values()].filter((r) => matches(r, f))),
      findOne: (f: any) => Promise.resolve([...rows.values()].find((r) => matches(r, f)) ?? null),
      findById: (id: string) => Promise.resolve(rows.has(id) ? { ...rows.get(id) } : null),
      create: async (d: any) => {
        // Real time, but strictly increasing so same-millisecond writes keep their order.
        lastTs = Math.max(Date.now(), lastTs + 1);
        const doc = { ...d, _id: `id${++seq}`, createdAt: new Date(lastTs) };
        rows.set(doc._id, doc);
        return { ...doc };
      },
      findByIdAndUpdate: async (id: string, u: any) => {
        const doc = rows.get(id);
        if (!doc) return null;
        Object.assign(doc, u.$set ?? {});
        for (const [k, v] of Object.entries(u.$inc ?? {})) doc[k] = (doc[k] ?? 0) + (v as number);
        return { ...doc };
      },
      findByIdAndDelete: async (id: string) => {
        const doc = rows.get(id);
        rows.delete(id);
        return doc ?? null;
      },
    };
  };
  return { ExpenseLog: model(), RecurringBill: model(), VendorAccount: model(), VendorTxn: model(), LedgerSetting: model(), DailySaving: model() };
});

vi.mock('../src/models/ExpenseLog.model', async (orig) => ({ ...(await orig<any>()), ExpenseLog: fake.ExpenseLog }));
vi.mock('../src/models/RecurringBill.model', async (orig) => ({ ...(await orig<any>()), RecurringBill: fake.RecurringBill }));
vi.mock('../src/models/DailySaving.model', () => ({ DailySaving: fake.DailySaving }));
vi.mock('../src/models/LedgerSetting.model', async (orig) => ({ ...(await orig<any>()), LedgerSetting: fake.LedgerSetting }));
vi.mock('../src/models/VendorAccount.model', async (orig) => ({
  ...(await orig<any>()),
  VendorAccount: fake.VendorAccount,
  VendorTxn: fake.VendorTxn,
}));

import app from '../src/app';
import { env } from '../src/config/env';

const auth = { Authorization: 'Bearer firebase-id-token' };
const api = {
  get: (p: string) => request(app).get(`/api/ledger${p}`).set(auth),
  post: (p: string, body: any = {}) => request(app).post(`/api/ledger${p}`).set(auth).send(body),
  del: (p: string) => request(app).delete(`/api/ledger${p}`).set(auth),
  put: (p: string, body: any = {}) => request(app).put(`/api/ledger${p}`).set(auth).send(body),
};

beforeEach(() => {
  for (const m of Object.values(fake)) m.rows.clear();
  env.STAFF_AUTH_ENFORCE = true;
  env.ADMIN_EMAILS = ['owner@shop.com'];
  env.STAFF_EMAILS = ['counter@shop.com'];
  verifyIdToken.mockResolvedValue({ uid: 'a1', email: 'owner@shop.com', email_verified: true });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ledger API', () => {
  it('is admin only', async () => {
    verifyIdToken.mockResolvedValue({ uid: 's1', email: 'counter@shop.com', email_verified: true });
    expect((await api.get('/logs')).status).toBe(403);
  });

  it('logs a categorised expense and rejects unknown categories', async () => {
    const r = await api.post('/logs', { category: 'staff_snacks', amount: 120, note: 'tea' });
    expect(r.status).toBe(201);
    expect((await api.post('/logs', { category: 'rent', amount: 10 })).status).toBe(400);
    const list = await api.get('/logs?category=staff_snacks');
    expect(list.body.data).toHaveLength(1);
  });

  it('recurring: partial pay, full pay, reset, undo via log delete', async () => {
    const bill = (await api.post('/recurring', { name: 'Rent', kind: 'ongoing', category: 'utility', amount: 25000 })).body.data;

    const p1 = await api.post(`/recurring/${bill._id}/pay`, { amount: 10000 });
    expect(p1.body.data.bill.dueRemaining).toBe(15000);
    expect((await api.post(`/recurring/${bill._id}/pay`, { amount: 20000 })).status).toBe(400); // more than due

    const p2 = await api.post(`/recurring/${bill._id}/pay`, { amount: 15000 });
    expect(p2.body.data.bill).toMatchObject({ dueRemaining: 0, paidInstallments: 1 });

    // deleting the completing payment re-opens the cycle
    await api.del(`/logs/${p2.body.data.log._id}`);
    let b = (await api.get('/recurring')).body.data[0];
    expect(b).toMatchObject({ dueRemaining: 15000, paidInstallments: 0 });

    await api.post(`/recurring/${bill._id}/pay`, { amount: 15000 });
    const reset = await api.post(`/recurring/${bill._id}/reset`, { amount: 27000 });
    expect(reset.body.data).toMatchObject({ amount: 27000, dueRemaining: 27000, cycle: 2 });

    // a payment from cycle 1 can no longer be undone
    expect((await api.del(`/logs/${p1.body.data.log._id}`)).status).toBe(400);
    b = (await api.get('/recurring')).body.data[0];
    expect(b.dueRemaining).toBe(27000);
    expect((await api.get(`/recurring/${bill._id}/payments`)).body.data).toHaveLength(2);
  });

  it('split rent: each part logs with its own method; undo restores that part', async () => {
    const bill = (await api.post('/recurring', {
      name: 'Shop Rent',
      kind: 'ongoing',
      parts: [{ label: 'Rent cash', method: 'cash', amount: 12500 }, { label: 'Rent online', method: 'upi', amount: 12500 }],
    })).body.data;
    expect(bill).toMatchObject({ amount: 25000, dueRemaining: 25000 });

    const online = await api.post(`/recurring/${bill._id}/pay`, { amount: 12500, part: 1 });
    expect(online.body.data.log).toMatchObject({ paymentMethod: 'upi', note: 'Shop Rent · Rent online' });
    expect(online.body.data.bill.parts[1].due).toBe(0);
    expect((await api.post(`/recurring/${bill._id}/pay`, { amount: 100 })).status).toBe(400); // no part

    await api.del(`/logs/${online.body.data.log._id}`);
    const b = (await api.get('/recurring')).body.data[0];
    expect(b.parts[1].due).toBe(12500);
    expect((await api.post('/recurring', { name: 'X', kind: 'ongoing', parts: [{ method: 'cash', amount: 0 }] })).status).toBe(400);
  });

  it('one-time personal due: payments carry the scope into the log', async () => {
    const due = (await api.post('/recurring', { name: 'Dr Shah', kind: 'one_time', category: 'home', amount: 5000, scope: 'personal', dueDate: '2026-11-05' })).body.data;
    expect(due).toMatchObject({ scope: 'personal', dueRemaining: 5000 });
    const r = await api.post(`/recurring/${due._id}/pay`, { amount: 5000 });
    expect(r.body.data.bill.status).toBe('completed');
    expect(r.body.data.log).toMatchObject({ scope: 'personal', category: 'home' });
    expect((await api.post('/recurring', { name: 'X', kind: 'one_time', amount: 5, scope: 'family' })).status).toBe(400);
  });

  it('installment bill completes after its last installment', async () => {
    const bill = (await api.post('/recurring', { name: 'Qardan', kind: 'installment', amount: 5000, totalInstallments: 2, paidInstallments: 1 })).body.data;
    expect(bill.category).toBe('utility');
    const r = await api.post(`/recurring/${bill._id}/pay`, { amount: 5000 });
    expect(r.body.data.bill.status).toBe('completed');
    expect((await api.post(`/recurring/${bill._id}/reset`)).status).toBe(400);
    expect((await api.post('/recurring', { name: 'X', kind: 'installment', amount: 5 })).status).toBe(400);
  });

  it('vendor: add, pay any amount, reduce; payments land in the expense log', async () => {
    const v = (await api.post('/vendors', { name: 'Aziz Mirror', openingBalance: 10000 })).body.data;
    expect(v.balance).toBe(10000);
    expect((await api.post('/vendors', { name: 'Aziz Mirror' })).status).toBe(400);

    await api.post(`/vendors/${v._id}/txns`, { type: 'add', amount: 2500 });
    const pay = await api.post(`/vendors/${v._id}/txns`, { type: 'pay', amount: 3333, paymentMethod: 'upi' });
    expect(pay.body.data.vendor.balance).toBe(9167);
    await api.post(`/vendors/${v._id}/txns`, { type: 'less', amount: 167 });

    const txns = (await api.get(`/vendors/${v._id}/txns`)).body.data;
    expect(txns.map((t: any) => t.balanceAfter)).toEqual([9000, 9167, 12500, 10000]);

    const logs = (await api.get('/logs')).body.data;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ category: 'vendor', amount: 3333, paymentMethod: 'upi' });

    // deleting the expense entry puts the amount back on the vendor and drops the txn
    await api.del(`/logs/${logs[0]._id}`);
    expect((await api.get('/vendors')).body.data[0].balance).toBe(12333);
    expect((await api.get(`/vendors/${v._id}/txns`)).body.data).toHaveLength(3);

    // deleting a pay txn removes its expense entry too
    const pay2 = await api.post(`/vendors/${v._id}/txns`, { type: 'pay', amount: 333 });
    await api.del(`/vendor-txns/${pay2.body.data.txn._id}`);
    expect((await api.get('/logs')).body.data).toHaveLength(0);
    expect((await api.get('/vendors')).body.data[0].balance).toBe(12333);

    expect((await api.del(`/vendors/${v._id}`)).status).toBe(400); // still owes
  });

  it('editing a vendor entry type fixes the balance and the expense log', async () => {
    const v = (await api.post('/vendors', { name: 'Tulsi', openingBalance: 30000 })).body.data;
    const wrong = (await api.post(`/vendors/${v._id}/txns`, { type: 'less', amount: 13500 })).body.data.txn;
    expect((await api.get('/logs')).body.data).toHaveLength(0);

    // discount → payment: balance unchanged, expense logged
    let r = await api.put(`/vendor-txns/${wrong._id}`, { type: 'pay', paymentMethod: 'upi' });
    expect(r.body.data.vendor.balance).toBe(16500);
    let logs = (await api.get('/logs')).body.data;
    expect(logs).toMatchObject([{ amount: 13500, paymentMethod: 'upi', category: 'vendor' }]);

    // amount change on a payment updates the log too
    r = await api.put(`/vendor-txns/${wrong._id}`, { amount: 12000 });
    expect(r.body.data.vendor.balance).toBe(18000);
    expect((await api.get('/logs')).body.data[0].amount).toBe(12000);

    // payment → bill: log removed, balance goes the other way
    r = await api.put(`/vendor-txns/${wrong._id}`, { type: 'add' });
    expect(r.body.data.vendor.balance).toBe(42000);
    expect((await api.get('/logs')).body.data).toHaveLength(0);
    expect((await api.put('/vendor-txns/nope', { type: 'pay' })).status).toBe(404);
  });

  it('cash purchase counts toward the category cap and owes nothing', async () => {
    const v = (await api.post('/vendors', { name: 'Attar House', category: 'fragrance' })).body.data;
    expect(v.category).toBe('fragrance');
    expect((await api.post('/vendors', { name: 'X', category: 'shoes' })).status).toBe(400);

    await api.put('/settings', { purchaseCaps: { fragrance: 10000 } });
    const r = await api.post(`/vendors/${v._id}/txns`, { type: 'add', amount: 12000, paidNow: true });
    expect(r.body.data.vendor.balance).toBe(0);
    expect((await api.get('/logs')).body.data).toMatchObject([{ category: 'vendor', amount: 12000 }]);

    const sum = (await api.get('/vendor-summary')).body.data;
    expect(sum.categories.find((c: any) => c.category === 'fragrance')).toMatchObject({ purchased: 12000, paid: 12000, cap: 10000 });
    expect((await api.get('/settings')).body.data).toMatchObject({ vendorSharePct: 40, purchaseCaps: { fragrance: 10000, lens: 0 } });
  });

  it('owner schedule: set, clear and read back with actual payments', async () => {
    const v = (await api.post('/vendors', { name: 'Tulsi', category: 'frame', openingBalance: 30000 })).body.data;
    expect((await api.put('/schedule', { month: '2026-11', vendorId: v._id, amount: 10000 })).status).toBe(200);
    await api.put('/schedule', { month: '2026-12', vendorId: v._id, amount: 8000 });
    await api.put('/schedule', { month: '2026-12', vendorId: v._id, amount: 0 });
    expect((await api.put('/schedule', { month: 'Nov', vendorId: v._id, amount: 1 })).status).toBe(400);
    expect((await api.put('/schedule', { month: '2026-11', vendorId: 'nope', amount: 1 })).status).toBe(404);

    await api.post(`/vendors/${v._id}/txns`, { type: 'pay', amount: 2000 });
    const r = (await api.get('/schedule')).body.data;
    expect(r.schedule).toEqual({ '2026-11': { [v._id]: 10000 } });
    expect(r.paid[r.thisMonth][v._id]).toBe(2000);
  });

  it('this month tracking starts when the plan is first saved', async () => {
    const v = (await api.post('/vendors', { name: 'Lens Wholesale', category: 'lens' })).body.data;
    await api.post(`/vendors/${v._id}/txns`, { type: 'add', amount: 100000 }); // old dues typed in
    await new Promise((r) => setTimeout(r, 5));
    await api.put('/settings', { repaymentBudget: 40000, purchaseCaps: { fragrance: 20000 } });
    await new Promise((r) => setTimeout(r, 5));
    await api.post(`/vendors/${v._id}/txns`, { type: 'pay', amount: 15000 });

    const r = (await api.get('/vendor-summary')).body.data.repayment;
    expect(r).toMatchObject({ added: 0, paid: 15000, unusedCap: 20000, target: 60000, reduced: 15000, left: 45000 });
  });

  it('daily savings: one entry per day, re-saving replaces it', async () => {
    expect((await api.put('/daily-savings', { day: '2026-10-26', fixed: 2250, vendor: 1700 })).status).toBe(200);
    await api.put('/daily-savings', { day: '2026-10-26', fixed: 2000, vendor: 1700, note: 'short day' });
    await api.put('/daily-savings', { day: '2026-10-25', fixed: 2250, vendor: 0 });
    expect((await api.put('/daily-savings', { day: '26-10-2026', fixed: 1, vendor: 1 })).status).toBe(400);
    expect((await api.put('/daily-savings', { day: '2026-10-27', fixed: -1, vendor: 1 })).status).toBe(400);

    const all = (await request(app).get('/api/ledger/daily-savings?from=2026-10-01&to=2026-10-31').set(auth)).body.data;
    expect(all.map((d: any) => [d.day, d.fixed, d.vendor])).toEqual([
      ['2026-10-26', 2000, 1700],
      ['2026-10-25', 2250, 0],
    ]);
  });
});
